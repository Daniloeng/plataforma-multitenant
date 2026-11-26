package br.dev.plataforma.pedidos;

import java.time.Instant;
import java.util.List;

/** Representação pública de um pedido (schema {@code Pedido}). */
public record PedidoView(
    String id,
    String clienteId,
    StatusPedido status,
    List<ItemView> itens,
    Dinheiro total,
    MotivoCancelamento motivoCancelamento,
    Instant criadoEm,
    Instant atualizadoEm) {

  /** Item do pedido (schema {@code ItemPedido}). */
  public record ItemView(
      String produtoId, String sku, String nome, int quantidade, Dinheiro precoUnitario) {}

  static PedidoView of(PedidoDocument doc) {
    return new PedidoView(
        doc.getId(),
        doc.getClienteId(),
        doc.getStatus(),
        doc.getItens().stream()
            .map(
                i ->
                    new ItemView(
                        i.produtoId(),
                        i.sku(),
                        i.nome(),
                        i.quantidade(),
                        new Dinheiro(i.precoUnitarioCentavos(), doc.getMoeda())))
            .toList(),
        new Dinheiro(doc.getTotalCentavos(), doc.getMoeda()),
        doc.getMotivoCancelamento(),
        doc.getCriadoEm(),
        doc.getAtualizadoEm());
  }

  /** Página da listagem, do mais recente para o mais antigo. */
  public record Pagina(List<PedidoView> itens, String proximoCursor) {}

  /**
   * Resultado da criação.
   *
   * @param repetido true quando a chave de idempotência já tinha criado este pedido
   */
  public record Criacao(PedidoView pedido, boolean repetido) {}
}
