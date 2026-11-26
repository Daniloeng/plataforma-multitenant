package br.dev.plataforma.pagamentos;

/** Estados do pagamento (schema {@code StatusPagamento}). AUTORIZANDO fica para um gateway real. */
public enum StatusPagamento {
  AUTORIZANDO,
  APROVADO,
  RECUSADO,
  ESTORNADO
}
