package br.dev.plataforma.status;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.IntStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Executa todas as verificações em paralelo (uma virtual thread por componente) e agrega o
 * resultado. Assim o tempo de resposta é o da verificação mais lenta, não a soma de todas.
 */
public class StatusService implements AutoCloseable {

  private static final Logger LOG = LoggerFactory.getLogger(StatusService.class);

  private final List<ComponentCheck> checks;
  private final Clock clock;
  private final String version;
  private final RuntimeInfo runtime;

  public StatusService(List<ComponentCheck> checks, Clock clock, String version) {
    this(checks, clock, version, null);
  }

  public StatusService(
      List<ComponentCheck> checks, Clock clock, String version, RuntimeInfo runtime) {
    this.checks = List.copyOf(checks);
    this.clock = clock;
    this.version = version;
    this.runtime = runtime;
  }

  public PlatformStatus current() {
    Instant checkedAt = clock.instant();
    List<ComponentStatus> components;
    try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
      List<Future<ComponentStatus>> futures =
          checks.stream().map(c -> executor.submit(c::check)).toList();
      components =
          IntStream.range(0, checks.size())
              .mapToObj(i -> resultOf(futures.get(i), checks.get(i)))
              .toList();
    }
    return new PlatformStatus(
        PlatformStatus.aggregate(components), checkedAt, version, components, runtime);
  }

  private static ComponentStatus resultOf(Future<ComponentStatus> future, ComponentCheck check) {
    try {
      return future.get();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return ComponentStatus.down(check.name(), check.type(), 0, "interrompido");
    } catch (Exception e) {
      // O detalhe completo fica só no log: a resposta é pública e chega a qualquer navegador.
      Throwable cause = e.getCause() == null ? e : e.getCause();
      LOG.warn("Falha inesperada na verificação de {}", check.name(), cause);
      return ComponentStatus.down(
          check.name(), check.type(), 0, "falha inesperada: " + cause.getClass().getSimpleName());
    }
  }

  /** Fecha as verificações que guardam conexões (ex.: clientes MongoDB). */
  @Override
  public void close() throws Exception {
    Exception failure = null;
    for (ComponentCheck check : checks) {
      if (check instanceof AutoCloseable closeable) {
        try {
          closeable.close();
        } catch (Exception e) {
          // Continua fechando as demais; a primeira falha é relançada com as outras anexadas.
          if (failure == null) {
            failure = e;
          } else {
            failure.addSuppressed(e);
          }
        }
      }
    }
    if (failure != null) {
      throw failure;
    }
  }
}
