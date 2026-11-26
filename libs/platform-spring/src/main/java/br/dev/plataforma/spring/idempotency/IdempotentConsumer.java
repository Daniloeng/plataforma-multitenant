package br.dev.plataforma.spring.idempotency;

import java.time.Clock;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Garante que um evento é processado uma vez por consumidor, mesmo com reentrega do Pulsar.
 *
 * <p>Use dentro da mesma transação do efeito: se o efeito falhar, o registro também é desfeito e a
 * reentrega processa de novo; se o registro já existir, o efeito não roda.
 */
public class IdempotentConsumer {

  private final MongoOperations mongo;
  private final Clock clock;

  public IdempotentConsumer(MongoOperations mongo, Clock clock) {
    this.mongo = mongo;
    this.clock = clock;
  }

  /**
   * Executa {@code effect} só se ({@code tenantId}, {@code consumer}, {@code eventId}) ainda não
   * foi processado.
   *
   * @return true se executou; false se era duplicado
   */
  public boolean processOnce(String tenantId, String consumer, String eventId, Runnable effect) {
    if (!TransactionSynchronizationManager.isActualTransactionActive()) {
      throw new IllegalStateException(
          "processOnce precisa de uma transação: o registro e o efeito são gravados juntos");
    }
    String id = tenantId + ":" + consumer + ":" + eventId;
    // Consulta antes de inserir: um DuplicateKeyException dentro da transação do MongoDB aborta a
    // transação inteira. A chave única continua protegendo a corrida entre duas entregas
    // simultâneas (aí o commit de uma delas falha e o Pulsar reentrega).
    if (mongo.exists(Query.query(Criteria.where("_id").is(id)), ProcessedEvent.class)) {
      return false;
    }
    try {
      mongo.insert(new ProcessedEvent(id, tenantId, consumer, eventId, clock.instant()));
    } catch (DuplicateKeyException e) {
      return false;
    }
    effect.run();
    return true;
  }
}
