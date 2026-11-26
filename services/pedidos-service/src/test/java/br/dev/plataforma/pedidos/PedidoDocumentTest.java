package br.dev.plataforma.pedidos;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class PedidoDocumentTest {

  private static final Instant CRIADO = Instant.parse("2026-11-20T10:00:00Z");
  private static final Instant MUDOU = Instant.parse("2026-11-20T10:05:00Z");

  /** Pedido gravado antes do Dia 8: sem o campo historico. */
  private static PedidoDocument legado(StatusPedido status, MotivoCancelamento motivo) {
    PedidoDocument doc = new PedidoDocument();
    ReflectionTestUtils.setField(doc, "status", status);
    ReflectionTestUtils.setField(doc, "criadoEm", CRIADO);
    ReflectionTestUtils.setField(doc, "atualizadoEm", MUDOU);
    ReflectionTestUtils.setField(doc, "pagamentoId", "pag-1");
    ReflectionTestUtils.setField(doc, "motivoCancelamento", motivo);
    return doc;
  }

  @Test
  void pedidoLegadoGanhaHistoricoDerivadoDoStatus() {
    assertThat(legado(StatusPedido.PENDENTE, null).marcos())
        .containsExactly(new PedidoDocument.Marco(TipoMarco.CRIADO, CRIADO, null));
    assertThat(legado(StatusPedido.CONFIRMADO, null).marcos())
        .extracting(PedidoDocument.Marco::tipo)
        .containsExactly(TipoMarco.CRIADO, TipoMarco.PAGO);
    PedidoDocument expirado = legado(StatusPedido.CANCELADO, MotivoCancelamento.EXPIRADO);
    ReflectionTestUtils.setField(expirado, "pagamentoId", null);
    assertThat(expirado.marcos().get(1))
        .isEqualTo(new PedidoDocument.Marco(TipoMarco.CANCELADO, MUDOU, "EXPIRADO"));
    // Pago e cancelado antes do Dia 8: já foi estornado.
    assertThat(legado(StatusPedido.CANCELADO, MotivoCancelamento.SOLICITADO_PELO_CLIENTE).marcos())
        .extracting(PedidoDocument.Marco::tipo)
        .containsExactly(
            TipoMarco.CRIADO, TipoMarco.PAGO, TipoMarco.CANCELADO, TipoMarco.ESTORNADO);
    assertThat(legado(StatusPedido.CANCELADO, MotivoCancelamento.PAGAMENTO_RECUSADO).marcos())
        .extracting(PedidoDocument.Marco::tipo)
        .containsExactly(TipoMarco.CRIADO, TipoMarco.RECUSADO, TipoMarco.CANCELADO);
  }

  @Test
  void estornoEntraUmaVezSo() {
    PedidoDocument doc =
        new PedidoDocument("p1", "cli", "chave-123", "h", List.of(), 100, "BRL", CRIADO);
    doc.confirmar("pag-1", MUDOU);
    doc.cancelar(MotivoCancelamento.SOLICITADO_PELO_CLIENTE, MUDOU);
    assertThat(doc.estornar("pag-1", MUDOU)).isTrue();
    assertThat(doc.estornar("pag-1", MUDOU)).isFalse();
    assertThat(doc.marcos())
        .extracting(PedidoDocument.Marco::tipo)
        .containsExactly(
            TipoMarco.CRIADO, TipoMarco.PAGO, TipoMarco.CANCELADO, TipoMarco.ESTORNADO);
  }
}
