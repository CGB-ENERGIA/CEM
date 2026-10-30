// Função da Vercel que atende toda a API (/api/*).
// Usa o mesmo tratador do servidor local (server/api.ts), então as regras são as mesmas.

import { ErroValidacao, tratarApi } from "../server/api";

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      return await tratarApi(req, url);
    } catch (erro) {
      if (erro instanceof ErroValidacao) {
        return Response.json({ erro: erro.message }, { status: erro.status });
      }
      console.error(erro);
      return Response.json({ erro: "Erro interno do servidor." }, { status: 500 });
    }
  },
};
