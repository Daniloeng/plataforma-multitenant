package br.dev.plataforma.contracts;

import static org.assertj.core.api.Assertions.assertThat;

import br.dev.plataforma.contracts.pedidos.ItemPedido;
import br.dev.plataforma.contracts.pedidos.PedidoCriado;
import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.apache.avro.io.BinaryEncoder;
import org.apache.avro.io.DecoderFactory;
import org.apache.avro.io.EncoderFactory;
import org.apache.avro.specific.SpecificDatumReader;
import org.apache.avro.specific.SpecificDatumWriter;
import org.apache.avro.specific.SpecificRecord;
import org.junit.jupiter.api.Test;

/** As classes geradas serializam e deserializam sem perda (o que o Pulsar fará com AVRO). */
class SerializationTest {

  @org.junit.jupiter.api.BeforeAll
  static void confiarNosContratos() {
    AvroTrust.trustContracts();
  }

  private static final Instant AGORA = Instant.now().truncatedTo(ChronoUnit.MILLIS);

  @SuppressWarnings("unchecked")
  private static <T extends SpecificRecord> T idaEVolta(T evento) throws IOException {
    var out = new ByteArrayOutputStream();
    BinaryEncoder encoder = EncoderFactory.get().binaryEncoder(out, null);
    new SpecificDatumWriter<T>(evento.getSchema()).write(evento, encoder);
    encoder.flush();
    var reader = new SpecificDatumReader<T>((Class<T>) evento.getClass());
    return reader.read(null, DecoderFactory.get().binaryDecoder(out.toByteArray(), null));
  }

  @Test
  void pedidoCriadoComItens() throws IOException {
    PedidoCriado evento =
        PedidoCriado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId("acme")
            .setOccurredAt(AGORA)
            .setPedidoId("ped-1")
            .setClienteId("cli-9")
            .setItens(
                List.of(
                    ItemPedido.newBuilder()
                        .setProdutoId("p-1")
                        .setSku("SKU-1")
                        .setQuantidade(3)
                        .setPrecoUnitarioCentavos(1990)
                        .build()))
            .setTotalCentavos(5970)
            .build();

    PedidoCriado lido = idaEVolta(evento);

    assertThat(lido).isEqualTo(evento);
    assertThat(lido.getMoeda()).isEqualTo("BRL");
    assertThat(lido.getTraceparent()).isNull();
  }

  @Test
  void tenantCriadoComEnums() throws IOException {
    TenantCriado evento =
        TenantCriado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId("acme")
            .setOccurredAt(AGORA)
            .setTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
            .setNome("ACME Distribuidora")
            .setPlano(Plano.PROFISSIONAL)
            .setNivelIsolamento(NivelIsolamento.BRIDGE)
            .build();

    assertThat(idaEVolta(evento)).isEqualTo(evento);
  }
}
