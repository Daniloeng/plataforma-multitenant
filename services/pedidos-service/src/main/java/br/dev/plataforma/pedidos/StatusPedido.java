package br.dev.plataforma.pedidos;

/**
 * Estados do pedido (schema {@code StatusPedido}). PENDENTE até o pagamento; CONFIRMADO quando
 * aprovado; CANCELADO pelo cliente, pelo tenant, por recusa do pagamento ou por expiração.
 */
public enum StatusPedido {
  PENDENTE,
  CONFIRMADO,
  CANCELADO
}
