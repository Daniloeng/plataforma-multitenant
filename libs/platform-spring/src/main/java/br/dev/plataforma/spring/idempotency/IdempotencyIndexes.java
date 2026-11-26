package br.dev.plataforma.spring.idempotency;

import br.dev.plataforma.spring.outbox.OutboxMessage;
import com.mongodb.MongoCommandException;
import java.time.Duration;
import org.springframework.dao.DataAccessException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.data.mongodb.core.index.IndexOperations;

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
    ensureTtl(
        mongo.indexOps(ProcessedEvent.class),
        new Index().on("processedAt", Sort.Direction.ASC).expire(retention).named("ttl_processed"));
    mongo
        .indexOps(OutboxMessage.class)
        .ensureIndex(
            new Index()
                .on("publishedAt", Sort.Direction.ASC)
                .on("occurredAt", Sort.Direction.ASC)
                .on("sequence", Sort.Direction.ASC)
                .named("ix_pending_seq"));
    ensureTtl(
        mongo.indexOps(OutboxMessage.class),
        new Index().on("publishedAt", Sort.Direction.ASC).expire(retention).named("ttl_published"));
  }

  /**
   * Índice TTL com o mesmo nome e outra validade (a retenção mudou) dá IndexOptionsConflict (código
   * 85) e impediria o serviço de subir: recria o índice com a validade nova.
   */
  static void ensureTtl(IndexOperations ops, Index ttl) {
    try {
      ops.ensureIndex(ttl);
    } catch (DataAccessException e) {
      if (!(e.getCause() instanceof MongoCommandException m) || m.getErrorCode() != 85) {
        throw e;
      }
      String name = (String) ttl.getIndexOptions().get("name");
      ops.dropIndex(name);
      ops.ensureIndex(ttl);
    }
  }
}
