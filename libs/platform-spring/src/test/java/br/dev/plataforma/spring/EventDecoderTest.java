package br.dev.plataforma.spring;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import br.dev.plataforma.spring.events.EventDecoder;
import br.dev.plataforma.spring.events.WriterSchemaResolver;
import br.dev.plataforma.spring.outbox.AvroCodec;
import java.nio.ByteBuffer;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.pulsar.client.api.Message;
import org.junit.jupiter.api.Test;

class EventDecoderTest {

  static final String TOPICO = "persistent://plataforma/tenants/tenant.criado.v1";

  static byte[] versao(long v) {
    return ByteBuffer.allocate(Long.BYTES).putLong(v).array();
  }

  @Test
  @SuppressWarnings("unchecked")
  void decodificaComOSchemaDoEscritorEGuardaEmCache() {
    AtomicInteger consultas = new AtomicInteger();
    WriterSchemaResolver resolver =
        new WriterSchemaResolver(
            (topico, v) -> {
              consultas.incrementAndGet();
              assertThat(topico).isEqualTo(TOPICO);
              assertThat(v).isEqualTo(3L);
              return TenantCriado.getClassSchema().toString();
            });
    TenantCriado evento =
        TenantCriado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId("acme")
            .setOccurredAt(Instant.parse("2026-11-26T10:00:00Z"))
            .setNome("ACME")
            .setPlano(Plano.GRATUITO)
            .setNivelIsolamento(NivelIsolamento.POOL)
            .build();
    Message<byte[]> msg = mock(Message.class);
    when(msg.getTopicName()).thenReturn(TOPICO);
    when(msg.getSchemaVersion()).thenReturn(versao(3));
    when(msg.getValue()).thenReturn(AvroCodec.encode(evento));
    EventDecoder decoder = new EventDecoder(resolver);

    assertThat(decoder.decode(msg, TenantCriado.class)).isEqualTo(evento);
    assertThat(decoder.decode(msg, TenantCriado.class)).isEqualTo(evento);
    assertThat(consultas).hasValue(1);
  }

  @Test
  @SuppressWarnings("unchecked")
  void mensagemSemSchemaFalhaComMensagemClara() {
    Message<byte[]> msg = mock(Message.class);
    when(msg.getTopicName()).thenReturn(TOPICO);
    EventDecoder decoder = new EventDecoder(new WriterSchemaResolver((t, v) -> "{}"));

    assertThatThrownBy(() -> decoder.decode(msg, TenantCriado.class))
        .hasMessageContaining("sem schema");
  }

  @Test
  void falhaNaConsultaDoSchemaViraSchemaLookupException() {
    WriterSchemaResolver resolver =
        new WriterSchemaResolver(
            (t, v) -> {
              throw new java.io.IOException("admin fora do ar");
            });
    assertThatThrownBy(() -> resolver.resolve(TOPICO, versao(1)))
        .isInstanceOf(br.dev.plataforma.spring.events.SchemaLookupException.class)
        .hasRootCauseMessage("admin fora do ar");
    WriterSchemaResolver quebrado =
        new WriterSchemaResolver(
            (t, v) -> {
              throw new IllegalArgumentException("x");
            });
    assertThatThrownBy(() -> quebrado.resolve(TOPICO, versao(1)))
        .isInstanceOf(br.dev.plataforma.spring.events.SchemaLookupException.class);
  }

  @Test
  void schemaInvalidoNaoETemporario() {
    WriterSchemaResolver resolver = new WriterSchemaResolver((t, v) -> "{nao e json");
    assertThatThrownBy(() -> resolver.resolve(TOPICO, versao(1)))
        .isNotInstanceOf(br.dev.plataforma.spring.events.SchemaLookupException.class);
  }
}
