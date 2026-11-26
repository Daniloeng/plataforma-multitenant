package br.dev.plataforma.spring.outbox;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.apache.pulsar.client.api.Schema;
import org.apache.pulsar.common.schema.SchemaInfo;
import org.apache.pulsar.common.schema.SchemaType;

/**
 * Schema Pulsar que envia bytes Avro já serializados e declara o schema AVRO do evento ao Schema
 * Registry do tópico. Evita {@code Schema.NATIVE_AVRO}, que no cliente {@code pulsar-client-all}
 * espera a classe Avro sombreada e rejeita o {@code org.apache.avro.Schema} dos contratos.
 */
public final class AvroBytesSchema implements Schema<byte[]> {

  private final SchemaInfo info;

  public AvroBytesSchema(org.apache.avro.Schema avro) {
    this.info =
        SchemaInfo.builder()
            .name(avro.getFullName())
            .type(SchemaType.AVRO)
            .schema(avro.toString().getBytes(StandardCharsets.UTF_8))
            .properties(Map.of())
            .build();
  }

  @Override
  public byte[] encode(byte[] message) {
    return message;
  }

  @Override
  public byte[] decode(byte[] bytes, byte[] schemaVersion) {
    return bytes;
  }

  @Override
  public SchemaInfo getSchemaInfo() {
    return info;
  }

  @Override
  public Schema<byte[]> clone() {
    return this;
  }
}
