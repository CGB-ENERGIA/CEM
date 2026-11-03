import { join } from "node:path";
import { ErroValidacao, tratarApi } from "./api";

const dist = join(import.meta.dir, "..", "dist");
const porta = Number(process.env.PORT ?? 3000);

async function servirEstatico(pathname: string): Promise<Response> {
  // Pasta com barra final (ex.: /campo/) abre o index.html dela, como na Vercel.
  const relativo = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const alvo = join(dist, decodeURIComponent(relativo));
  if (!alvo.startsWith(dist)) {
    return new Response("Acesso negado.", { status: 403 });
  }

  const arquivo = Bun.file(alvo);
  if (await arquivo.exists()) {
    return new Response(arquivo);
  }

  const index = Bun.file(join(dist, "index.html"));
  if (!(await index.exists())) {
    return new Response("Rode `bun run build` antes de iniciar o servidor.", { status: 404 });
  }
  return new Response(index);
}

Bun.serve({
  port: porta,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await tratarApi(req, url);
      return await servirEstatico(url.pathname);
    } catch (erro) {
      if (erro instanceof ErroValidacao) {
        return Response.json({ erro: erro.message }, { status: erro.status });
      }
      console.error(erro);
      return Response.json({ erro: "Erro interno do servidor." }, { status: 500 });
    }
  },
});

console.log(`Servidor disponível em http://localhost:${porta}`);
