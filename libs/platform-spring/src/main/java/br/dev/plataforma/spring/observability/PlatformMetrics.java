package br.dev.plataforma.spring.observability;

import br.dev.plataforma.spring.isolation.PlatformDatabase;
import br.dev.plataforma.spring.isolation.TenantMigrator;
import br.dev.plataforma.spring.isolation.TenantPlacement;
import br.dev.plataforma.spring.isolation.TenantPlacements;
import br.dev.plataforma.spring.outbox.OutboxMessage;
import br.dev.plataforma.spring.outbox.OutboxRelay;
import io.micrometer.core.instrument.FunctionCounter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;

/**
 * Métricas da plataforma (ADR-0015), com os nomes que os alertas do Prometheus usam:
 *
 * <ul>
 *   <li>{@code plataforma_outbox_pendentes} e {@code plataforma_outbox_atraso_seconds}: eventos
 *       esperando publicação e a idade do mais antigo (relay parado ou Pulsar fora);
 *   <li>{@code plataforma_outbox_relay_lider}: 1 na réplica que publica; a soma entre réplicas
 *       precisa ser 1;
 *   <li>{@code plataforma_outbox_publicados_total} e {@code plataforma_outbox_falhas_total};
 *   <li>{@code plataforma_isolamento_migrando}, {@code plataforma_isolamento_tentativas} (maior
 *       número de falhas de uma migração em andamento) e {@code
 *       plataforma_isolamento_falhas_total}.
 * </ul>
 *
 * O consumo de eventos é medido pela observação do {@code EventSubscriber}. As contagens do outbox
 * vão ao MongoDB no máximo uma vez a cada {@value #CACHE_SECONDS} s, por mais que raspem.
 */
public class PlatformMetrics implements MeterBinder {

  private static final Logger LOG = LoggerFactory.getLogger(PlatformMetrics.class);
  static final long CACHE_SECONDS = 5;

  private final MongoOperations mongo;
  private final OutboxRelay relay;
  private final TenantPlacements placements;
  private final TenantMigrator migrator;
  private final Clock clock;

  private record OutboxSnapshot(long pending, double lagSeconds, Instant takenAt) {}

  private volatile OutboxSnapshot snapshot;

  /**
   * Qualquer parte pode ser nula: o serviço sem outbox ou sem isolamento não ganha essas métricas.
   */
  public PlatformMetrics(
      MongoOperations mongo,
      OutboxRelay relay,
      TenantPlacements placements,
      TenantMigrator migrator,
      Clock clock) {
    this.mongo = mongo;
    this.relay = relay;
    this.placements = placements;
    this.migrator = migrator;
    this.clock = clock;
  }

  @Override
  public void bindTo(MeterRegistry registry) {
    if (mongo != null) {
      Gauge.builder("plataforma.outbox.pendentes", this, m -> m.outbox().pending())
          .description("Eventos do outbox esperando publicação")
          .register(registry);
      Gauge.builder("plataforma.outbox.atraso", this, m -> m.outbox().lagSeconds())
          .description("Idade do evento pendente mais antigo do outbox")
          .baseUnit("seconds")
          .register(registry);
    }
    if (relay != null) {
      Gauge.builder("plataforma.outbox.relay.lider", relay, r -> r.isLeader() ? 1 : 0)
          .description("1 se esta réplica publica o outbox")
          .register(registry);
      FunctionCounter.builder("plataforma.outbox.publicados", relay, OutboxRelay::publishedCount)
          .description("Eventos publicados no Pulsar por esta réplica")
          .register(registry);
      FunctionCounter.builder("plataforma.outbox.falhas", relay, OutboxRelay::failureCount)
          .description("Publicações do outbox que falharam nesta réplica")
          .register(registry);
    }
    if (placements != null) {
      Gauge.builder("plataforma.isolamento.migrando", placements, p -> p.migrating().size())
          .description("Tenants com migração de nível em andamento")
          .register(registry);
      Gauge.builder(
              "plataforma.isolamento.tentativas",
              placements,
              p -> p.migrating().stream().mapToInt(TenantPlacement::attempts).max().orElse(0))
          .description("Maior número de falhas de uma migração em andamento")
          .register(registry);
    }
    if (migrator != null) {
      FunctionCounter.builder(
              "plataforma.isolamento.falhas", migrator, TenantMigrator::failureCount)
          .description("Migrações de nível que falharam nesta réplica")
          .register(registry);
    }
  }

  OutboxSnapshot outbox() {
    Instant now = clock.instant();
    OutboxSnapshot current = snapshot;
    if (current != null && current.takenAt().plusSeconds(CACHE_SECONDS).isAfter(now)) {
      return current;
    }
    OutboxSnapshot fresh;
    try {
      fresh = PlatformDatabase.call(() -> read(now));
    } catch (RuntimeException e) {
      LOG.debug("Métricas do outbox indisponíveis: {}", e.toString());
      fresh = new OutboxSnapshot(-1, Double.NaN, now);
    }
    snapshot = fresh;
    return fresh;
  }

  private OutboxSnapshot read(Instant now) {
    Query pending = Query.query(Criteria.where("publishedAt").isNull());
    long count = mongo.count(pending, OutboxMessage.class);
    if (count == 0) {
      return new OutboxSnapshot(0, 0, now);
    }
    OutboxMessage oldest =
        mongo.findOne(
            Query.query(Criteria.where("publishedAt").isNull())
                .with(Sort.by("occurredAt", "sequence"))
                .limit(1),
            OutboxMessage.class);
    double lag =
        oldest == null
            ? 0
            : Math.max(0, Duration.between(oldest.occurredAt(), now).toMillis() / 1000.0);
    return new OutboxSnapshot(count, lag, now);
  }
}
