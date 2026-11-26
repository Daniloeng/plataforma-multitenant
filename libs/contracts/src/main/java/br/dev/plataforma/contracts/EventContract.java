package br.dev.plataforma.contracts;

import java.util.List;
import java.util.Objects;
import org.apache.avro.Schema;

/**
 * Metadados de um evento de domínio, lidos das propriedades {@code x-*} do schema Avro.
 *
 * @param event nome do evento na linguagem do negócio (ex.: {@code pedido.criado})
 * @param topic tópico Pulsar completo
 * @param producer serviço dono do evento (o único que publica)
 * @param consumers serviços que consomem o evento
 * @param schema schema Avro do evento
 */
public record EventContract(
    String event, String topic, String producer, List<String> consumers, Schema schema) {

  public EventContract {
    Objects.requireNonNull(event, "event");
    Objects.requireNonNull(topic, "topic");
    Objects.requireNonNull(producer, "producer");
    Objects.requireNonNull(schema, "schema");
    consumers = consumers == null ? List.of() : List.copyOf(consumers);
  }

  /** Lê o contrato das propriedades do schema; falha se alguma propriedade obrigatória faltar. */
  public static EventContract from(Schema schema) {
    return new EventContract(
        requiredProp(schema, "x-evento"),
        requiredProp(schema, "x-topico"),
        requiredProp(schema, "x-produtor"),
        consumersOf(schema),
        schema);
  }

  private static String requiredProp(Schema schema, String name) {
    String value = schema.getProp(name);
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException(
          "Schema " + schema.getFullName() + " não tem a propriedade obrigatória " + name);
    }
    return value;
  }

  private static List<String> consumersOf(Schema schema) {
    Object raw = schema.getObjectProp("x-consumidores");
    if (raw == null) {
      return List.of();
    }
    if (raw instanceof List<?> list) {
      return list.stream().map(String::valueOf).toList();
    }
    throw new IllegalArgumentException(
        "x-consumidores de " + schema.getFullName() + " deve ser uma lista");
  }
}
