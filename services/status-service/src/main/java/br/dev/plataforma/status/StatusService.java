package br.dev.plataforma.status;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.IntStream;

/**
 * Executa todas as verificações em paralelo (uma virtual thread por componente) e agrega o
 * resultado. Assim o tempo de resposta é o da verificação mais lenta, não a soma de todas.
 */
public class StatusService implements AutoCloseable {

  private final List<ComponentCheck> checks;
  private final Clock clock;
  private final String version;

  public StatusService(List<ComponentCheck> checks, Clock clock, String version) {
    this.checks = List.copyOf(checks);
    this.clock = clock;
    this.version = version;
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
    return new PlatformStatus(PlatformStatus.aggregate(components), checkedAt, version, components);
  }

  private static ComponentStatus resultOf(Future<ComponentStatus> future, ComponentCheck check) {
    try {
      return future.get();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return ComponentStatus.down(check.name(), check.type(), 0, "interrompido");
    } catch (Exception e) {
      return ComponentStatus.down(
          check.name(), check.type(), 0, "falha inesperada: " + e.getMessage());
    }
  }

  /** Fecha as verificações que guardam conexões (ex.: clientes MongoDB). */
  @Override
  public void close() throws Exception {
    for (ComponentCheck check : checks) {
      if (check instanceof AutoCloseable closeable) {
        closeable.close();
      }
    }
  }
}
