package br.dev.plataforma.pedidos;

/** Tipos de marco da linha do tempo do pedido (schema {@code TipoMarco}). */
public enum TipoMarco {
  CRIADO,
  PAGO,
  RECUSADO,
  CANCELADO,
  ESTORNADO
}
