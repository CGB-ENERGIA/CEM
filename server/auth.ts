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
  const { data, error } = await db
    .from("usuarios")
    .select("id, login, nome, senha_hash")
    .eq("login", chaveLogin(login))
    .maybeSingle();
  if (error) throw error;

  const senhaConfere = await Bun.password.verify(senha, data?.senha_hash ?? HASH_DESCARTAVEL);
  if (!data || !senhaConfere) return null;
  return { id: data.id, login: data.login, nome: data.nome };
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

  const { data, error } = await db
    .from("sessoes")
    .select("expira_em, usuarios(id, login, nome)")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.usuarios) return null;

  const usuario = data.usuarios as unknown as UsuarioSessao;
  if (new Date(data.expira_em).getTime() < Date.now()) {
    await db.from("sessoes").delete().eq("token_hash", hash);
    return null;
  }
  return { id: usuario.id, login: usuario.login, nome: usuario.nome };
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
