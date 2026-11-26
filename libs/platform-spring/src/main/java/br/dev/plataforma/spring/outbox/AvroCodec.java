package br.dev.plataforma.spring.outbox;

import br.dev.plataforma.contracts.AvroTrust;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import org.apache.avro.Schema;
import org.apache.avro.io.BinaryEncoder;
import org.apache.avro.io.DecoderFactory;
import org.apache.avro.io.EncoderFactory;
import org.apache.avro.specific.SpecificData;
import org.apache.avro.specific.SpecificDatumReader;
import org.apache.avro.specific.SpecificDatumWriter;
import org.apache.avro.specific.SpecificRecord;

/** Serialização Avro binária dos eventos (o formato que vai no outbox e no Pulsar). */
public final class AvroCodec {

  static {
    AvroTrust.trustContracts();
  }

  private AvroCodec() {}

  @SuppressWarnings("unchecked")
  public static byte[] encode(SpecificRecord event) {
    try {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      BinaryEncoder encoder = EncoderFactory.get().binaryEncoder(out, null);
      new SpecificDatumWriter<SpecificRecord>((Class<SpecificRecord>) event.getClass())
          .write(event, encoder);
      encoder.flush();
      return out.toByteArray();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /**
   * Lê um evento escrito com o schema {@code writer} (o da mensagem, resolvido pelo schemaVersion
   * no Schema Registry) e o converte para o schema atual da classe. É o caminho certo para
   * consumidores: aceita produtores com versão mais nova ou mais antiga do contrato (FULL).
   */
  public static <T extends SpecificRecord> T decode(byte[] bytes, Schema writer, Class<T> type) {
    try {
      Schema reader = SpecificData.get().getSchema(type);
      return new SpecificDatumReader<T>(writer, reader)
          .read(null, DecoderFactory.get().binaryDecoder(bytes, null));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /**
   * Lê um evento escrito com o mesmo schema da classe (só quando os dois lados são da mesma
   * versão).
   */
  public static <T extends SpecificRecord> T decode(byte[] bytes, Class<T> type) {
    try {
      return new SpecificDatumReader<>(type)
          .read(null, DecoderFactory.get().binaryDecoder(bytes, null));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
