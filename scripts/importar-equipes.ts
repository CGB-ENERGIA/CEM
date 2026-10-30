// Importa o cadastro de equipes a partir de um arquivo JSON.
//
//   bun run scripts/importar-equipes.ts <arquivo.json>
//
// O arquivo é uma lista de objetos com: prefixo, nome, responsavel, supervisor, coordenador, gerencia,
// base, processo e status. O tipo de equipe não vem do arquivo: equipes já cadastradas mantêm o tipo
// atual, e equipes novas entram sem tipo até ele ser definido na aba Equipes.
// Precisa do arquivo .env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
// Pode rodar de novo: a importação atualiza os dados e não duplica equipes.

import { readFile } from "node:fs/promises";
import { db } from "../server/db";

interface LinhaEquipe {
  prefixo: string;
  nome: string | null;
  responsavel: string | null;
  supervisor: string | null;
  coordenador: string | null;
  gerencia: string | null;
  base: string | null;
  processo: string | null;
  status: "ativo" | "inativo";
}

const caminho = process.argv[2];
if (!caminho) {
  console.error("Uso: bun run scripts/importar-equipes.ts <arquivo.json>");
  process.exit(1);
}

const linhas = JSON.parse(await readFile(caminho, "utf-8")) as LinhaEquipe[];

const prefixos = new Set<string>();
for (const linha of linhas) {
  if (!linha.prefixo || linha.prefixo.length > 20) {
    console.error(`Prefixo inválido: "${linha.prefixo}"`);
    process.exit(1);
  }
  if (prefixos.has(linha.prefixo)) {
    console.error(`Prefixo repetido no arquivo: "${linha.prefixo}"`);
    process.exit(1);
  }
  prefixos.add(linha.prefixo);
}

const TAMANHO_LOTE = 100;
for (let inicio = 0; inicio < linhas.length; inicio += TAMANHO_LOTE) {
  const lote = linhas.slice(inicio, inicio + TAMANHO_LOTE);
  // tipo_id fica fora do envio: o upsert só atualiza as colunas enviadas, então o tipo atual é preservado.
  const { error } = await db.from("equipes").upsert(
    lote.map((linha) => ({
      prefixo: linha.prefixo,
      nome: linha.nome,
      responsavel: linha.responsavel,
      supervisor: linha.supervisor,
      coordenador: linha.coordenador,
      gerencia: linha.gerencia,
      base: linha.base,
      processo: linha.processo,
      status: linha.status,
    })),
    { onConflict: "prefixo" },
  );
  if (error) {
    console.error(`Falha no lote a partir da linha ${inicio + 1}:`, error.message);
    process.exit(1);
  }
}

const { count, error: erroContagem } = await db.from("equipes").select("prefixo", { count: "exact", head: true });
if (erroContagem) {
  console.error("Importado, mas não foi possível contar as equipes:", erroContagem.message);
  process.exit(1);
}
console.log(`${linhas.length} equipe(s) importada(s). Total cadastrado: ${count}.`);
