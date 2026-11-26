package br.dev.plataforma.spring.outbox;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.contracts.EventContract;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.apache.pulsar.client.api.Producer;
import org.apache.pulsar.client.api.PulsarClient;
import org.apache.pulsar.client.api.PulsarClientException;
import org.apache.pulsar.client.api.TypedMessageBuilder;

/**
 * Publica no Pulsar os bytes Avro já serializados pelo outbox, com o schema AVRO do contrato: o
 * schema do evento é registrado no Schema Registry do tópico (com a compatibilidade FULL do
 * namespace) sem depender do Avro sombreado do cliente Pulsar (ver {@link AvroBytesSchema}).
 */
public class PulsarEventPublisher implements EventPublisher, AutoCloseable {

  private final PulsarClient client;
  private final EventCatalog catalog;
  private final Duration timeout;

  /**
   * Um produtor por (tópico, schema gravado): itens antigos saem com o schema com que foram
   * escritos.
   */
  private final Map<ProducerKey, Producer<byte[]>> producers = new ConcurrentHashMap<>();

  private record ProducerKey(String topic, String schema) {}

  public PulsarEventPublisher(PulsarClient client, EventCatalog catalog, Duration timeout) {
    this.client = client;
    this.catalog = catalog;
    this.timeout = timeout;
  }

  @Override
  public void publish(OutboxMessage message) throws Exception {
    Producer<byte[]> producer =
        producers.computeIfAbsent(
            new ProducerKey(message.topic(), message.schema()), this::createProducer);
    TypedMessageBuilder<byte[]> builder =
        producer
            .newMessage()
            .key(message.key())
            .value(message.payload())
            .eventTime(message.occurredAt().toEpochMilli())
            .property("eventId", message.id())
            .property("tenantId", message.tenantId())
            .property("event", message.event());
    if (message.traceparent() != null) {
      builder.property("traceparent", message.traceparent());
    }
    builder.sendAsync().get(timeout.toMillis(), TimeUnit.MILLISECONDS);
  }

  private Producer<byte[]> createProducer(ProducerKey key) {
    String topic = key.topic();
    EventContract contract =
        catalog.all().stream()
            .filter(c -> c.topic().equals(topic))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Tópico fora do catálogo: " + topic));
    // Itens gravados antes desta versão da biblioteca não têm schema: usa o do contrato.
    org.apache.avro.Schema schema =
        key.schema() == null
            ? contract.schema()
            : new org.apache.avro.Schema.Parser().parse(key.schema());
    try {
      return client
          .newProducer(new AvroBytesSchema(schema))
          .topic(topic)
          .enableBatching(false)
          .sendTimeout((int) timeout.toMillis(), TimeUnit.MILLISECONDS)
          .create();
    } catch (PulsarClientException e) {
      throw new IllegalStateException("Não foi possível criar o produtor de " + topic, e);
    }
  }

  @Override
  public void close() {
    producers.values().forEach(Producer::closeAsync);
    producers.clear();
  }
}
