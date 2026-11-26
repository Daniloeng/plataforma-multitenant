package br.dev.plataforma.spring;

import static org.assertj.core.api.Assertions.assertThat;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import br.dev.plataforma.spring.outbox.AvroCodec;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.UUID;
import org.apache.avro.Schema;
import org.apache.avro.generic.GenericData;
import org.apache.avro.generic.GenericDatumWriter;
import org.apache.avro.generic.GenericRecord;
import org.apache.avro.io.BinaryEncoder;
import org.apache.avro.io.EncoderFactory;
import org.junit.jupiter.api.Test;

class AvroCodecTest {

  @Test
  void idaEVoltaComOMesmoSchema() {
    TenantCriado evento =
        TenantCriado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId("acme")
            .setOccurredAt(Instant.parse("2026-11-26T10:00:00Z"))
            .setNome("ACME")
            .setPlano(Plano.GRATUITO)
            .setNivelIsolamento(NivelIsolamento.POOL)
            .setVersao(2)
            .build();

    byte[] bytes = AvroCodec.encode(evento);

    assertThat(AvroCodec.decode(bytes, TenantCriado.class)).isEqualTo(evento);
    assertThat(AvroCodec.decode(bytes, TenantCriado.getClassSchema(), TenantCriado.class))
        .isEqualTo(evento);
  }

  /** Um produtor com a versão anterior do contrato (sem "versao"): o consumidor lê o default. */
  @Test
  void leEventoEscritoComSchemaAnteriorUsandoOSchemaDoEscritor() throws Exception {
    ObjectMapper json = new ObjectMapper();
    ObjectNode antigo = (ObjectNode) json.readTree(TenantCriado.getClassSchema().toString());
    ArrayNode campos = (ArrayNode) antigo.get("fields");
    for (int i = campos.size() - 1; i >= 0; i--) {
      if ("versao".equals(campos.get(i).get("name").asText())) {
        campos.remove(i);
      }
    }
    Schema escritor = new Schema.Parser().parse(antigo.toString());
    GenericRecord registro = new GenericData.Record(escritor);
    registro.put("eventId", UUID.randomUUID().toString());
    registro.put("tenantId", "acme");
    registro.put("occurredAt", 1_795_000_000_000L);
    registro.put("traceparent", null);
    registro.put("nome", "ACME");
    registro.put(
        "plano", new GenericData.EnumSymbol(escritor.getField("plano").schema(), "PROFISSIONAL"));
    registro.put(
        "nivelIsolamento",
        new GenericData.EnumSymbol(escritor.getField("nivelIsolamento").schema(), "SILO"));
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    BinaryEncoder encoder = EncoderFactory.get().binaryEncoder(out, null);
    new GenericDatumWriter<GenericRecord>(escritor).write(registro, encoder);
    encoder.flush();

    TenantCriado lido = AvroCodec.decode(out.toByteArray(), escritor, TenantCriado.class);

    assertThat(lido.getPlano()).isEqualTo(Plano.PROFISSIONAL);
    assertThat(lido.getNivelIsolamento()).isEqualTo(NivelIsolamento.SILO);
    assertThat(lido.getVersao()).isZero();
  }
}
