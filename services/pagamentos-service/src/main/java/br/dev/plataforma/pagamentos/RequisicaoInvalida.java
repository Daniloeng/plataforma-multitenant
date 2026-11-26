package br.dev.plataforma.pagamentos;

/** Parâmetro inválido: 400 {@code requisicao-invalida}. */
class RequisicaoInvalida extends RuntimeException {
  RequisicaoInvalida(String message) {
    super(message);
  }
}
