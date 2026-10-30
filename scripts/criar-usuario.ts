// Cria um usuário de acesso ao sistema.
//
//   bun run usuario:criar <login> "<nome completo>"
//
// A senha vem da variável CEM_SENHA ou, se ela não existir, da primeira linha da entrada padrão.
// Nunca é passada como argumento, para não ficar no histórico do terminal.
// Precisa do arquivo .env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.

import { db } from "../server/db";

const [login, ...partesNome] = process.argv.slice(2);
const nome = partesNome.join(" ").trim();

if (!login || !nome) {
  console.error('Uso: bun run usuario:criar <login> "<nome completo>"');
  process.exit(1);
}

async function lerSenha(): Promise<string> {
  if (process.env.CEM_SENHA) return process.env.CEM_SENHA;
  const texto = await new Response(Bun.stdin.stream()).text();
  return texto.split(/\r?\n/)[0] ?? "";
}

const senha = await lerSenha();
if (senha.length < 8) {
  console.error("A senha precisa ter pelo menos 8 caracteres.");
  process.exit(1);
}

const loginNormalizado = login.trim().toLowerCase();

const { data: existente, error: erroBusca } = await db
  .from("usuarios")
  .select("id")
  .eq("login", loginNormalizado)
  .maybeSingle();
if (erroBusca) {
  console.error("Não foi possível consultar o Supabase:", erroBusca.message);
  process.exit(1);
}
if (existente) {
  console.error(`Já existe um usuário com o login "${loginNormalizado}".`);
  process.exit(1);
}

const senhaHash = await Bun.password.hash(senha);
const { error } = await db.from("usuarios").insert({ login: loginNormalizado, nome, senha_hash: senhaHash });
if (error) {
  console.error("Não foi possível criar o usuário:", error.message);
  process.exit(1);
}
console.log(`Usuário "${loginNormalizado}" criado.`);
