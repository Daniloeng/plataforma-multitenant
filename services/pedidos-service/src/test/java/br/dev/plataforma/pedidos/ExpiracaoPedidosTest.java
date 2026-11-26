package br.dev.plataforma.pedidos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import br.dev.plataforma.core.IsolationLevel;
import br.dev.plataforma.core.TenantId;
import br.dev.plataforma.spring.isolation.TenantMigratingException;
import br.dev.plataforma.spring.isolation.TenantPlacement;
import br.dev.plataforma.spring.isolation.TenantPlacements;
import br.dev.plataforma.spring.tenancy.TenantContext;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.transaction.TransactionSystemException;

class ExpiracaoPedidosTest {

  private final MongoOperations mongo = mock(MongoOperations.class);
  private final PedidoService pedidos = mock(PedidoService.class);
  private final TenantPlacements mapa = mock(TenantPlacements.class);

  @SuppressWarnings("unchecked")
  private final ObjectProvider<TenantPlacements> provedor = mock(ObjectProvider.class);

  private final ExpiracaoPedidos job =
      new ExpiracaoPedidos(
          mongo,
          pedidos,
          Clock.fixed(Instant.parse("2026-11-26T12:00:00Z"), ZoneOffset.UTC),
          Duration.ofMinutes(15),
          provedor);

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

  private static TenantPlacement dedicado(String tenant, TenantPlacement.Status status) {
    return new TenantPlacement(
        TenantId.of(tenant),
        IsolationLevel.BRIDGE,
        "pedidos_t_" + tenant,
        status,
        null,
        null,
        null,
        0,
        1);
  }

  @Test
  void tambemBuscaNasDatabasesDedicadasProntasNoContextoDoTenant() {
    when(provedor.getIfAvailable()).thenReturn(mapa);
    when(mapa.dedicated())
        .thenReturn(
            List.of(
                dedicado("globex", TenantPlacement.Status.READY),
                dedicado("migrando", TenantPlacement.Status.MIGRATING)));
    PedidoDocument doPool = pedido("ped-pool");
    PedidoDocument daDedicada = pedido("ped-globex");
    List<String> contextos = new java.util.ArrayList<>();
    when(mongo.find(any(Query.class), eq(PedidoDocument.class)))
        .thenAnswer(
            inv -> {
              contextos.add(TenantContext.current().map(TenantId::value).orElse("padrao"));
              return contextos.size() == 1 ? List.of(doPool) : List.of(daDedicada);
            });
    when(pedidos.expirar(any())).thenReturn(true);

    assertThat(job.expirarVencidos()).isEqualTo(2);
    assertThat(contextos).containsExactly("padrao", "globex");
  }

  @Test
  void falhaNaDatabaseDedicadaNaoImpedeAsOutras() {
    when(provedor.getIfAvailable()).thenReturn(mapa);
    when(mapa.dedicated()).thenReturn(List.of(dedicado("globex", TenantPlacement.Status.READY)));
    PedidoDocument doPool = pedido("ped-pool");
    when(mongo.find(any(Query.class), eq(PedidoDocument.class)))
        .thenReturn(List.of(doPool))
        .thenThrow(new TenantMigratingException(TenantId.of("globex")));
    when(pedidos.expirar(any())).thenReturn(true);

    assertThat(job.expirarVencidos()).isEqualTo(1);
  }
}
