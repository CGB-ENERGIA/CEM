import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

export const COOKIE_SESSAO = "cem_sessao";

const DURACAO_MS = 12 * 60 * 60 * 1000;
const TENTATIVAS_MAX = 5;
const JANELA_BLOQUEIO_MS = 15 * 60 * 1000;

export interface UsuarioSessao {
  id: number;
  login: string;
  nome: string;
  // Pode abrir a página Usuários. Falso para todos enquanto a migração de perfil não tiver rodado.
  admin: boolean;
}

// As colunas admin e ativo vêm da migração 20261107100000_usuarios_perfil.sql. Enquanto ela não rodou, o login
// continua funcionando: todos entram como usuário comum e ativo, em vez de o sistema inteiro parar.
let perfilDisponivel: boolean | null = null;
let proximaSondaPerfil = 0;

async function colunasDeUsuario(): Promise<string> {
  if (perfilDisponivel === null || (!perfilDisponivel && Date.now() >= proximaSondaPerfil)) {
    const { error } = await db.from("usuarios").select("admin, ativo").limit(1);
    perfilDisponivel = !error;
    proximaSondaPerfil = Date.now() + 30_000;
  }
  return perfilDisponivel ? "id, login, nome, admin, ativo" : "id, login, nome";
}

interface LinhaUsuario {
  id: number;
  login: string;
  nome: string;
  admin?: boolean;
  ativo?: boolean;
  senha_hash?: string;
}

function paraSessao(linha: LinhaUsuario): UsuarioSessao {
  return { id: linha.id, login: linha.login, nome: linha.nome, admin: linha.admin === true };
}

// Hash descartável: faz a verificação de senha levar o mesmo tempo quando o login não existe.
const HASH_DESCARTAVEL = await Bun.password.hash(randomBytes(16).toString("hex"));

// Tentativas falhas ficam na memória do servidor. Com uma única instância, isso basta.
const falhasPorLogin = new Map<string, { contagem: number; inicio: number }>();

function chaveLogin(login: string): string {
  return login.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function loginBloqueado(login: string): boolean {
  const chave = chaveLogin(login);
  const registro = falhasPorLogin.get(chave);
  if (!registro) return false;
  if (Date.now() - registro.inicio > JANELA_BLOQUEIO_MS) {
    falhasPorLogin.delete(chave);
    return false;
  }
  return registro.contagem >= TENTATIVAS_MAX;
}

export function registrarFalhaLogin(login: string) {
  const chave = chaveLogin(login);
  const registro = falhasPorLogin.get(chave);
  if (!registro || Date.now() - registro.inicio > JANELA_BLOQUEIO_MS) {
    falhasPorLogin.set(chave, { contagem: 1, inicio: Date.now() });
  } else {
    registro.contagem += 1;
  }
}

export function limparFalhasLogin(login: string) {
  falhasPorLogin.delete(chaveLogin(login));
}

export async function verificarCredenciais(login: string, senha: string): Promise<UsuarioSessao | null> {
  const colunas = await colunasDeUsuario();
  const { data: bruto, error } = await db
    .from("usuarios")
    .select(`${colunas}, senha_hash`)
    .eq("login", chaveLogin(login))
    .maybeSingle();
  if (error) throw error;
  const data = bruto as unknown as LinhaUsuario | null;

  const senhaConfere = await Bun.password.verify(senha, data?.senha_hash ?? HASH_DESCARTAVEL);
  // Usuário desativado recebe a mesma resposta de senha errada.
  if (!data || !senhaConfere || data.ativo === false) return null;
  return paraSessao(data);
}

export async function criarSessao(usuarioId: number): Promise<string> {
  // Limpeza das sessões vencidas, para a tabela não crescer sem fim.
  await db.from("sessoes").delete().lt("expira_em", new Date().toISOString());

  const token = randomBytes(32).toString("base64url");
  const { error } = await db.from("sessoes").insert({
    token_hash: hashToken(token),
    usuario_id: usuarioId,
    expira_em: new Date(Date.now() + DURACAO_MS).toISOString(),
  });
  if (error) throw error;
  return token;
}

export async function usuarioDaSessao(token: string | null): Promise<UsuarioSessao | null> {
  if (!token) return null;
  const hash = hashToken(token);

  const colunas = await colunasDeUsuario();
  const { data, error } = await db
    .from("sessoes")
    .select(`expira_em, usuarios(${colunas})`)
    .eq("token_hash", hash)
    .maybeSingle();
  if (error) throw error;
  const sessaoLida = data as unknown as { expira_em: string; usuarios: LinhaUsuario | null } | null;
  if (!sessaoLida || !sessaoLida.usuarios) return null;

  const usuario = sessaoLida.usuarios;
  if (new Date(sessaoLida.expira_em).getTime() < Date.now() || usuario.ativo === false) {
    await db.from("sessoes").delete().eq("token_hash", hash);
    return null;
  }
  return paraSessao(usuario);
}

// Encerra as sessões abertas de um usuário (senha redefinida, usuário desativado). Pode manter a sessão atual.
export async function encerrarSessoesDoUsuario(usuarioId: number, manterToken?: string | null) {
  let consulta = db.from("sessoes").delete().eq("usuario_id", usuarioId);
  if (manterToken) consulta = consulta.neq("token_hash", hashToken(manterToken));
  const { error } = await consulta;
  if (error) throw error;
}

export async function encerrarSessao(token: string) {
  const { error } = await db.from("sessoes").delete().eq("token_hash", hashToken(token));
  if (error) throw error;
}

export function lerTokenDoCookie(cabecalho: string | null): string | null {
  for (const parte of (cabecalho ?? "").split(";")) {
    const [nome, ...valor] = parte.trim().split("=");
    if (nome === COOKIE_SESSAO) return valor.join("=") || null;
  }
  return null;
}

export function cabecalhoCookie(token: string, seguro: boolean, expirar = false): string {
  const partes = [
    `${COOKIE_SESSAO}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${expirar ? 0 : DURACAO_MS / 1000}`,
  ];
  if (seguro) partes.push("Secure");
  return partes.join("; ");
}
