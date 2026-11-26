package br.dev.plataforma.spring.events;

import br.dev.plataforma.spring.outbox.AvroCodec;
import org.apache.avro.specific.SpecificRecord;
import org.apache.pulsar.client.api.Message;

/**
 * Lê eventos do Pulsar com o schema do escritor e converte para a versão que o consumidor conhece.
 * Use sempre este decoder em consumidores: {@code AvroCodec.decode(bytes, Classe.class)} só
 * funciona quando produtor e consumidor têm exatamente a mesma versão do contrato.
 */
public class EventDecoder {

  private final WriterSchemaResolver schemas;

  public EventDecoder(WriterSchemaResolver schemas) {
    this.schemas = schemas;
  }

  public <T extends SpecificRecord> T decode(Message<byte[]> message, Class<T> type) {
    byte[] version = message.getSchemaVersion();
    if (version == null || version.length != Long.BYTES) {
      throw new IllegalArgumentException(
          "Mensagem sem schema no tópico " + message.getTopicName() + ": não dá para decodificar");
    }
    return AvroCodec.decode(
        message.getValue(), schemas.resolve(message.getTopicName(), version), type);
  }
}
