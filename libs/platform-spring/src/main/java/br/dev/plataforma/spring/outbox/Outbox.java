package br.dev.plataforma.spring.outbox;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.contracts.EventContract;
import br.dev.plataforma.spring.isolation.PlatformDatabase;
import java.time.Instant;
import org.apache.avro.specific.SpecificRecord;
import org.bson.types.ObjectId;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Grava eventos no outbox. Só pode ser chamado dentro de uma transação ({@code @Transactional}),
 * junto com a mudança de estado que gerou o evento: sem transação, lança exceção em vez de arriscar
 * gravar o estado e perder o evento.
 */
public class Outbox {

  private final MongoOperations mongo;
  private final EventCatalog catalog;
  private final String service;

  /**
   * @param service contexto deste serviço ({@code x-produtor}, ex.: tenants); se informado, só
   *     eventos que ele produz podem entrar no outbox (só o dono publica, ADR-0003)
   */
  public Outbox(MongoOperations mongo, EventCatalog catalog, String service) {
    this.mongo = mongo;
    this.catalog = catalog;
    this.service = service;
  }

  /**
   * Agenda a publicação de {@code event}.
   *
   * @param event evento gerado pelo Avro (precisa estar no {@link EventCatalog})
   * @param aggregateId id do agregado; compõe a chave da mensagem com o tenantId
   */
  public OutboxMessage append(SpecificRecord event, String aggregateId) {
    if (!TransactionSynchronizationManager.isActualTransactionActive()) {
      throw new IllegalStateException(
          "Outbox.append precisa de uma transação: grave o estado e o evento juntos"
              + " (@Transactional)");
    }
    EventContract contract = catalog.of(event.getClass());
    if (service != null && !service.equals(contract.producer())) {
      throw new IllegalArgumentException(
          "O serviço '"
              + service
              + "' não pode publicar "
              + contract.event()
              + ": o produtor é '"
              + contract.producer()
              + "'.");
    }
    String eventId = field(event, "eventId").toString();
    String tenantId = field(event, "tenantId").toString();
    Object traceparent = field(event, "traceparent");
    Instant occurredAt = (Instant) field(event, "occurredAt");
    OutboxMessage message =
        new OutboxMessage(
            eventId,
            tenantId,
            contract.event(),
            contract.topic(),
            tenantId + ":" + aggregateId,
            AvroCodec.encode(event),
            event.getSchema().toString(),
            traceparent == null ? null : traceparent.toString(),
            occurredAt,
            new ObjectId().toHexString(),
            null,
            0,
            null);
    // O outbox fica na database padrão mesmo para tenant com database dedicada (ADR-0014): o relay
    // lê um lugar só.
    return PlatformDatabase.call(() -> mongo.insert(message));
  }

  private static Object field(SpecificRecord event, String name) {
    return event.get(event.getSchema().getField(name).pos());
  }
}
