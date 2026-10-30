import { createClient } from "@supabase/supabase-js";

// Cliente do Supabase usado só no servidor. A chave service_role ignora o RLS,
// por isso nunca pode sair do backend.
const url = process.env.SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !chave) {
  throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo .env (veja .env.example).");
}

export const db = createClient(url, chave, {
  auth: { persistSession: false, autoRefreshToken: false },
});
