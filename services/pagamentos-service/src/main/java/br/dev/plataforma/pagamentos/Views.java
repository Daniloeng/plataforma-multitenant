package br.dev.plataforma.pagamentos;

import java.time.Instant;
import java.util.List;

/** Representações públicas (pagamentos.yaml). */
final class Views {

  private Views() {}

  /** Schema {@code Pagamento}. */
  record PagamentoView(
      String id,
      String pedidoId,
      String clienteId,
      StatusPagamento status,
      Dinheiro valor,
      String motivoRecusa,
      Instant criadoEm,
      Instant atualizadoEm) {

    static PagamentoView of(PagamentoDocument d) {
      return new PagamentoView(
          d.getId(),
          d.getPedidoId(),
          d.getClienteId(),
          d.getStatus(),
          new Dinheiro(d.getValorCentavos(), d.getMoeda()),
          d.getMotivoRecusa(),
          d.getCriadoEm(),
          d.getAtualizadoEm());
    }
  }

  /** Schema {@code Lancamento}. */
  record LancamentoView(
      String id,
      String pagamentoId,
      String pedidoId,
      Lancamento.Conta conta,
      Lancamento.Natureza natureza,
      Dinheiro valor,
      Instant ocorridoEm) {

    static LancamentoView of(Lancamento l) {
      return new LancamentoView(
          l.getId(),
          l.getPagamentoId(),
          l.getPedidoId(),
          l.getConta(),
          l.getNatureza(),
          new Dinheiro(l.getValorCentavos(), l.getMoeda()),
          l.getOcorridoEm());
    }
  }

  record PaginaPagamentos(List<PagamentoView> itens, String proximoCursor) {}

  /**
   * @param saldo receita líquida do tenant em todas as páginas
   */
  record Extrato(List<LancamentoView> itens, Dinheiro saldo, String proximoCursor) {}
}
