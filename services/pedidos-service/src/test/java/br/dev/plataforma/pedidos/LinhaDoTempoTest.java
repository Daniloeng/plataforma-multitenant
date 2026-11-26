package br.dev.plataforma.pedidos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.test.util.ReflectionTestUtils;

class LinhaDoTempoTest {

  private final MongoTemplate mongo = mock(MongoTemplate.class);
  private final LinhaDoTempo linha =
      new LinhaDoTempo(
          mongo,
          Duration.ofMinutes(5),
          Duration.ofSeconds(15),
          2,
          3,
          new org.springframework.beans.factory.support.StaticListableBeanFactory()
              .getBeanProvider(br.dev.plataforma.spring.isolation.TenantPlacements.class));

  private static PedidoDocument pedido(String tenant, String id, long versao) {
    PedidoDocument doc =
        new PedidoDocument(
            id,
            "cli",
            "chave-123",
            "h",
            List.of(),
            100,
            "BRL",
            Instant.parse("2026-11-26T10:00:00Z"));
    doc.setTenantId(tenant);
    ReflectionTestUtils.setField(doc, "version", versao);
    return doc;
  }

  private void ligar() {
    ReflectionTestUtils.setField(linha, "rodando", true);
  }

  @AfterEach
  void desligar() {
    linha.stop();
  }

  @Test
  void foraDoArRespondeIndisponivel() {
    assertThatThrownBy(() -> linha.abrir("acme", "p1", true, () -> pedido("acme", "p1", 0)))
        .isInstanceOf(LinhaDoTempo.Indisponivel.class);
  }

  @Test
  void limitesPorTenantEPorReplica() {
    ligar();
    linha.abrir("acme", "p1", true, () -> pedido("acme", "p1", 0));
    linha.abrir("acme", "p2", true, () -> pedido("acme", "p2", 0));
    assertThatThrownBy(() -> linha.abrir("acme", "p3", true, () -> pedido("acme", "p3", 0)))
        .isInstanceOf(LinhaDoTempo.MuitasConexoes.class)
        .hasMessageContaining("tenant");
    linha.abrir("globex", "g1", true, () -> pedido("globex", "g1", 0));
    assertThatThrownBy(() -> linha.abrir("initech", "i1", true, () -> pedido("initech", "i1", 0)))
        .isInstanceOf(LinhaDoTempo.MuitasConexoes.class)
        .hasMessageContaining("instância");
    assertThat(linha.abertas()).isEqualTo(3);
    assertThat(linha.health().getDetails()).containsEntry("conexoes", 3);
  }

  @Test
  void leituraQueFalhaDesfazORegistro() {
    ligar();
    assertThatThrownBy(
            () ->
                linha.abrir(
                    "acme",
                    "p1",
                    false,
                    () -> {
                      throw new PedidosExceptions.NaoEncontrado("p1");
                    }))
        .isInstanceOf(PedidosExceptions.NaoEncontrado.class);
    assertThat(linha.abertas()).isZero();
  }

  @Test
  void publicacaoEBatimentoNaoQuebramComPedidoSemAssinanteOuBancoFora() throws Exception {
    ligar();
    linha.abrir("acme", "p1", true, () -> pedido("acme", "p1", 0));
    linha.publicar(pedido("acme", "outro", 3)); // ninguém acompanha
    linha.publicar(pedido("acme", "p1", 0)); // mesma versão: descartada
    linha.publicar(pedido("acme", "p1", 1));
    when(mongo.findOne(any(Query.class), eq(PedidoDocument.class)))
        .thenThrow(new IllegalStateException("fora do ar"))
        .thenReturn(pedido("acme", "p1", 2));
    linha.bater();
    linha.bater();
    Thread.sleep(200);
    assertThat(linha.abertas()).isEqualTo(1);
  }
}
