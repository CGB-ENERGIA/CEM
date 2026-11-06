// Erro com status HTTP para respostas de validação e de regra de negócio.
export class ErroValidacao extends Error {
  constructor(
    mensagem: string,
    readonly status = 400,
  ) {
    super(mensagem);
  }
}
