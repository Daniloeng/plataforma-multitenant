package br.dev.plataforma.pedidos;

/**
 * Estados do pedido (schema {@code StatusPedido}). No Dia 6 o pedido fica PENDENTE ou CANCELADO.
 */
public enum StatusPedido {
  PENDENTE,
  CONFIRMADO,
  CANCELADO
}
