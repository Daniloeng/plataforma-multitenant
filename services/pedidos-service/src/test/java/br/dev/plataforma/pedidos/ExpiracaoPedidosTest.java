package br.dev.plataforma.pedidos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.transaction.TransactionSystemException;

class ExpiracaoPedidosTest {

  private final MongoOperations mongo = mock(MongoOperations.class);
  private final PedidoService pedidos = mock(PedidoService.class);
  private final ExpiracaoPedidos job =
      new ExpiracaoPedidos(
          mongo,
          pedidos,
          Clock.fixed(Instant.parse("2026-11-26T12:00:00Z"), ZoneOffset.UTC),
          Duration.ofMinutes(15));

  private static PedidoDocument pedido(String id) {
    PedidoDocument p = mock(PedidoDocument.class);
    when(p.getId()).thenReturn(id);
    when(p.getTenantId()).thenReturn("acme");
    return p;
  }

  @Test
  void pedidoComErroInesperadoSaiDasProximasRodadas() {
    PedidoDocument ruim = pedido("ped-ruim");
    PedidoDocument bom = pedido("ped-bom");
    when(mongo.find(any(Query.class), eq(PedidoDocument.class))).thenReturn(List.of(ruim, bom));
    when(pedidos.expirar("ped-ruim")).thenThrow(new IllegalStateException("dado quebrado"));
    when(pedidos.expirar("ped-bom")).thenReturn(true);

    assertThat(job.expirarVencidos()).isEqualTo(1);
    job.expirarVencidos();

    ArgumentCaptor<Query> consultas = ArgumentCaptor.forClass(Query.class);
    verify(mongo, org.mockito.Mockito.times(2)).find(consultas.capture(), eq(PedidoDocument.class));
    assertThat(consultas.getAllValues().get(1).getQueryObject().get("_id").toString())
        .contains("ped-ruim");
  }

  @Test
  void conflitoNoCommitNaoTiraOPedidoDasRodadas() {
    PedidoDocument disputado = pedido("ped-1");
    when(mongo.find(any(Query.class), eq(PedidoDocument.class))).thenReturn(List.of(disputado));
    when(pedidos.expirar("ped-1")).thenThrow(new TransactionSystemException("WriteConflict"));

    assertThat(job.expirarVencidos()).isZero();
    job.expirarVencidos();

    ArgumentCaptor<Query> consultas = ArgumentCaptor.forClass(Query.class);
    verify(mongo, org.mockito.Mockito.times(2)).find(consultas.capture(), eq(PedidoDocument.class));
    assertThat(consultas.getAllValues().get(1).getQueryObject().get("_id").toString())
        .doesNotContain("ped-1");
  }
}
