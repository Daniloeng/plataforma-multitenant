package br.dev.plataforma.spring.outbox;

import java.time.Clock;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

/**
 * Publica os eventos pendentes do outbox, na ordem em que aconteceram.
 *
 * <p>Na primeira falha, o lote para: publicar o evento seguinte antes do que falhou quebraria a
 * ordem por agregado. A mensagem que falhou é tentada de novo no próximo ciclo. A entrega é pelo
 * menos uma vez: se o serviço cair entre publicar e marcar, o evento sai de novo, e os consumidores
 * descartam pela deduplicação de eventId.
 *
 * <p>Com um {@link RelayLease}, só a réplica dona publica (ADR-0015); as outras só conferem o lease
 * a cada ciclo.
 */
public class OutboxRelay {

  private static final Logger LOG = LoggerFactory.getLogger(OutboxRelay.class);

  private final MongoOperations mongo;
  private final EventPublisher publisher;
  private final Clock clock;
  private final int batchSize;
  private final RelayLease lease;
  private final AtomicLong published = new AtomicLong();
  private final AtomicLong failures = new AtomicLong();

  /**
   * @param lease quem pode publicar entre as réplicas; {@code null} só em teste (sem lease, toda
   *     réplica se acha líder e publica)
   */
  public OutboxRelay(
      MongoOperations mongo,
      EventPublisher publisher,
      Clock clock,
      int batchSize,
      RelayLease lease) {
    this.mongo = mongo;
    this.publisher = publisher;
    this.clock = clock;
    this.batchSize = batchSize;
    this.lease = lease;
  }

  /** Eventos publicados por esta réplica desde a subida (métrica). */
  public long publishedCount() {
    return published.get();
  }

  /** Publicações que falharam nesta réplica desde a subida (métrica). */
  public long failureCount() {
    return failures.get();
  }

  /** Se esta réplica publica agora: sem lease, sempre. */
  public boolean isLeader() {
    return lease == null || lease.isLeader();
  }

  /** Desligamento: solta o lease para outra réplica assumir já. */
  public void close() {
    if (lease != null) {
      lease.release();
    }
  }

  /**
   * Ciclo agendado: nunca propaga exceção, porque uma exceção cancelaria o agendamento e o outbox
   * pararia de ser publicado para sempre (ex.: MongoDB fora do ar por alguns segundos).
   */
  public void runCycle() {
    try {
      publishPending();
    } catch (RuntimeException e) {
      LOG.warn("Ciclo do relay do outbox falhou; tenta de novo no próximo", e);
    }
  }

  /** Um ciclo do relay. Devolve quantas mensagens foram publicadas. */
  public int publishPending() {
    if (lease != null && !lease.tryAcquire()) {
      return 0;
    }
    Query pending =
        Query.query(Criteria.where("publishedAt").isNull())
            .with(Sort.by("occurredAt", "sequence"))
            .limit(batchSize);
    List<OutboxMessage> batch = mongo.find(pending, OutboxMessage.class);
    int published = 0;
    for (OutboxMessage message : batch) {
      if (lease != null && !lease.tryAcquire()) {
        break; // perdeu o lease no meio do lote: a nova dona continua de onde parou
      }
      try {
        publisher.publish(message);
      } catch (Exception e) {
        if (e instanceof InterruptedException) {
          Thread.currentThread().interrupt();
        }
        LOG.warn(
            "Falha ao publicar {} ({}); nova tentativa no próximo ciclo",
            message.id(),
            message.event(),
            e);
        failures.incrementAndGet();
        mongo.updateFirst(
            Query.query(Criteria.where("_id").is(message.id())),
            new Update().inc("attempts", 1).set("lastError", e.getClass().getSimpleName()),
            OutboxMessage.class);
        break;
      }
      mongo.updateFirst(
          Query.query(Criteria.where("_id").is(message.id())),
          Update.update("publishedAt", clock.instant()),
          OutboxMessage.class);
      published++;
      this.published.incrementAndGet();
    }
    return published;
  }
}
