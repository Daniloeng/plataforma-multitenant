package br.dev.plataforma.pedidos;

/**
 * Motivos de cancelamento (schema {@code MotivoCancelamento}, o mesmo enum do pedido.cancelado).
 */
public enum MotivoCancelamento {
  PAGAMENTO_RECUSADO,
  SOLICITADO_PELO_CLIENTE,
  EXPIRADO,
  OUTRO,
  /** Cancelado por gestor-tenant ou plataforma-admin, e não pelo próprio cliente. */
  CANCELADO_PELO_TENANT
}
