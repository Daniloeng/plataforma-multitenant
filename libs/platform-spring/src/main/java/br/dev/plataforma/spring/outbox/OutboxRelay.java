package br.dev.plataforma.spring.outbox;

import java.time.Clock;
import java.util.List;
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
 */
public class OutboxRelay {

  private static final Logger LOG = LoggerFactory.getLogger(OutboxRelay.class);

  private final MongoOperations mongo;
  private final EventPublisher publisher;
  private final Clock clock;
  private final int batchSize;

  public OutboxRelay(MongoOperations mongo, EventPublisher publisher, Clock clock, int batchSize) {
    this.mongo = mongo;
    this.publisher = publisher;
    this.clock = clock;
    this.batchSize = batchSize;
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
    Query pending =
        Query.query(Criteria.where("publishedAt").isNull())
            .with(Sort.by("occurredAt", "sequence"))
            .limit(batchSize);
    List<OutboxMessage> batch = mongo.find(pending, OutboxMessage.class);
    int published = 0;
    for (OutboxMessage message : batch) {
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
    }
    return published;
  }
}
