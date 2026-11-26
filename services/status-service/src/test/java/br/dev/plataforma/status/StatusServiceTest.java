package br.dev.plataforma.status;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class StatusServiceTest {

  private static final Instant AGORA = Instant.parse("2026-11-26T12:00:00Z");
  private static final Clock RELOGIO = Clock.fixed(AGORA, ZoneOffset.UTC);

  @Test
  void agregaResultadosNaOrdemDasVerificacoes() {
    var service =
        new StatusService(
            List.of(FakeCheck.up("mongo-a"), FakeCheck.up("mongo-b")), RELOGIO, "0.1.0");

    PlatformStatus status = service.current();

    assertThat(status.status()).isEqualTo(HealthState.UP);
    assertThat(status.checkedAt()).isEqualTo(AGORA);
    assertThat(status.version()).isEqualTo("0.1.0");
    assertThat(status.components())
        .extracting(ComponentStatus::name)
        .containsExactly("mongo-a", "mongo-b");
  }

  @Test
  void verificacaoQueLancaExcecaoViraDown() {
    var falha =
        new FakeCheck(
            "mongo-quebrado",
            () -> {
              throw new IllegalStateException("boom");
            });
    var service = new StatusService(List.of(FakeCheck.up("ok"), falha), RELOGIO, "v");

    PlatformStatus status = service.current();

    assertThat(status.status()).isEqualTo(HealthState.DEGRADED);
    ComponentStatus quebrado = status.components().get(1);
    assertThat(quebrado.status()).isEqualTo(HealthState.DOWN);
    assertThat(quebrado.type()).isEqualTo(ComponentType.MONGODB);
    assertThat(quebrado.details()).contains("boom");
  }

  @Test
  void executaVerificacoesEmParalelo() {
    Duration espera = Duration.ofMillis(400);
    List<ComponentCheck> lentas =
        List.of(lenta("a", espera), lenta("b", espera), lenta("c", espera));
    var service = new StatusService(lentas, RELOGIO, "v");

    long inicio = System.nanoTime();
    service.current();
    long duracaoMs = Duration.ofNanos(System.nanoTime() - inicio).toMillis();

    // Em série levaria 1200 ms; em paralelo, pouco mais de 400 ms.
    assertThat(duracaoMs).isLessThan(1000);
  }

  @Test
  void threadInterrompidaMarcaComponenteComoDown() {
    var service = new StatusService(List.of(lenta("lenta", Duration.ofSeconds(5))), RELOGIO, "v");
    Thread.currentThread().interrupt();
    try {
      PlatformStatus status = service.current();
      assertThat(status.components().getFirst().details()).isEqualTo("interrompido");
      assertThat(status.status()).isEqualTo(HealthState.DOWN);
    } finally {
      Thread.interrupted();
    }
  }

  @Test
  void closeFechaVerificacoesQueGuardamRecursos() throws Exception {
    FakeCheck check = FakeCheck.up("a");
    ComponentCheck semRecurso =
        new ComponentCheck() {
          @Override
          public String name() {
            return "b";
          }

          @Override
          public ComponentType type() {
            return ComponentType.PULSAR;
          }

          @Override
          public ComponentStatus check() {
            return ComponentStatus.up("b", ComponentType.PULSAR, 0, null);
          }
        };
    var service = new StatusService(List.of(check, semRecurso), RELOGIO, "v");

    service.close();

    assertThat(check.closed).isTrue();
  }

  private static ComponentCheck lenta(String nome, Duration espera) {
    return new FakeCheck(
        nome,
        () -> {
          try {
            Thread.sleep(espera);
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
          return ComponentStatus.up(nome, ComponentType.MONGODB, espera.toMillis(), null);
        });
  }
}
