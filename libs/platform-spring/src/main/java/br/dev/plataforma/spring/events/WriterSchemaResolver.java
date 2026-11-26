package br.dev.plataforma.spring.events;

import java.nio.ByteBuffer;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.apache.avro.Schema;

/**
 * Descobre o schema Avro com que uma mensagem foi escrita, pelo {@code schemaVersion} que o Pulsar
 * grava em cada mensagem, consultando o Schema Registry do tópico (com cache: a versão de um schema
 * nunca muda). É o que permite ler eventos de produtores com outra versão do contrato (ADR-0008).
 */
public class WriterSchemaResolver {

  /** Consulta ao Schema Registry; separada para os testes não precisarem de um Pulsar. */
  @FunctionalInterface
  public interface SchemaSource {
    String schemaJson(String topic, long version) throws Exception;
  }

  private record Key(String topic, long version) {}

  private final SchemaSource source;
  private final Map<Key, Schema> cache = new ConcurrentHashMap<>();

  public WriterSchemaResolver(SchemaSource source) {
    this.source = source;
  }

  /**
   * @param schemaVersion bytes de {@code Message.getSchemaVersion()} (um long big-endian)
   */
  public Schema resolve(String topic, byte[] schemaVersion) {
    long version = ByteBuffer.wrap(schemaVersion).getLong();
    return cache.computeIfAbsent(
        new Key(topic, version),
        k -> {
          try {
            return new Schema.Parser().parse(source.schemaJson(k.topic(), k.version()));
          } catch (RuntimeException e) {
            throw e;
          } catch (Exception e) {
            throw new IllegalStateException("Falha ao buscar o schema de " + k.topic(), e);
          }
        });
  }
}
