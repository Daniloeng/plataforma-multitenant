package br.dev.plataforma.spring.idempotency;

import br.dev.plataforma.spring.outbox.OutboxMessage;
import java.time.Duration;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.index.Index;

/** Cria os índices do outbox e da deduplicação. Idempotente: roda a cada inicialização. */
public final class IdempotencyIndexes {

  private IdempotencyIndexes() {}

  public static void ensure(MongoOperations mongo, Duration retention) {
    mongo
        .indexOps(ProcessedEvent.class)
        .ensureIndex(
            new Index()
                .on("tenantId", Sort.Direction.ASC)
                .on("consumer", Sort.Direction.ASC)
                .on("eventId", Sort.Direction.ASC)
                .unique()
                .named("uk_tenant_consumer_event"));
    mongo
        .indexOps(ProcessedEvent.class)
        .ensureIndex(
            new Index()
                .on("processedAt", Sort.Direction.ASC)
                .expire(retention)
                .named("ttl_processed"));
    mongo
        .indexOps(OutboxMessage.class)
        .ensureIndex(
            new Index()
                .on("publishedAt", Sort.Direction.ASC)
                .on("occurredAt", Sort.Direction.ASC)
                .named("ix_pending"));
    mongo
        .indexOps(OutboxMessage.class)
        .ensureIndex(
            new Index()
                .on("publishedAt", Sort.Direction.ASC)
                .expire(retention)
                .named("ttl_published"));
  }
}
