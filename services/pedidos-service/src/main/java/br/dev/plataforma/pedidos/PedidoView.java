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
    String pagamentoId,
    MotivoCancelamento motivoCancelamento,
    Instant criadoEm,
    Instant atualizadoEm,
    List<PedidoDocument.Marco> historico) {

  /** Item do pedido (schema {@code ItemPedido}). */
  public record ItemView(
      String produtoId, String sku, String nome, int quantidade, Dinheiro precoUnitario) {}

  static PedidoView of(PedidoDocument doc) {
    return of(doc, true);
  }

  /**
   * @param veMotivoRecusa false para o comprador: o motivo exato da recusa do gateway é do tenant
   *     (Dia 7), então o marco RECUSADO sai sem detalhe
   */
  static PedidoView of(PedidoDocument doc, boolean veMotivoRecusa) {
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
        doc.getPagamentoId(),
        doc.getMotivoCancelamento(),
        doc.getCriadoEm(),
        doc.getAtualizadoEm(),
        veMotivoRecusa
            ? doc.marcos()
            : doc.marcos().stream()
                .map(
                    m ->
                        m.tipo() == TipoMarco.RECUSADO
                            ? new PedidoDocument.Marco(m.tipo(), m.em(), null)
                            : m)
                .toList());
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
