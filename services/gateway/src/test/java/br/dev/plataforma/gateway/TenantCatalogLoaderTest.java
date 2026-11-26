package br.dev.plataforma.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import br.dev.plataforma.spring.events.EventDecoder;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.apache.pulsar.client.api.Message;
import org.apache.pulsar.client.api.PulsarClient;
import org.junit.jupiter.api.Test;

class TenantCatalogLoaderTest {

  private static final String CRIADO = "persistent://plataforma/tenants/tenant.criado.v1";

  private TenantCatalogLoader loader(TenantDirectory directory, EventDecoder decoder, URI tenants) {
    var props =
        new GatewayProperties(
            null, null, null, new GatewayProperties.Services(tenants, null), null, null, null);
    return new TenantCatalogLoader(
        directory,
        mock(PulsarClient.class),
        decoder,
        mock(EventCatalog.class),
        props,
        new ObjectMapper());
  }

  @Test
  @SuppressWarnings("unchecked")
  void eventoIlegivelEDescartadoSemTravarOsSeguintes() {
    EventDecoder decoder = mock(EventDecoder.class);
    when(decoder.decode(any(Message.class), any()))
        .thenThrow(new IllegalStateException("schema desconhecido"));
    Message<byte[]> msg = mock(Message.class);
    when(msg.getTopicName()).thenReturn(CRIADO);
    var directory = new TenantDirectory();

    var loader = loader(directory, decoder, URI.create("http://127.0.0.1:1"));
    loader.handleSafely(msg, CRIADO);
    loader.handleSafely(msg, CRIADO);

    assertThat(loader.discardedEvents()).isEqualTo(2);
    assertThat(directory.all()).isEmpty();
  }

  @Test
  @SuppressWarnings("unchecked")
  void eventoLegivelAtualizaOCatalogo() {
    EventDecoder decoder = mock(EventDecoder.class);
    TenantCriado evento =
        TenantCriado.newBuilder()
            .setEventId(java.util.UUID.randomUUID())
            .setTenantId("acme")
            .setOccurredAt(java.time.Instant.now())
            .setNome("ACME")
            .setPlano(Plano.GRATUITO)
            .setNivelIsolamento(br.dev.plataforma.contracts.tenants.NivelIsolamento.POOL)
            .setVersao(0)
            .build();
    when(decoder.decode(any(Message.class), any())).thenReturn(evento);
    Message<byte[]> msg = mock(Message.class);
    when(msg.getTopicName()).thenReturn(CRIADO + "-partition-0");
    var directory = new TenantDirectory();

    var loader = loader(directory, decoder, URI.create("http://127.0.0.1:1"));
    loader.handleSafely(msg, CRIADO);

    assertThat(loader.discardedEvents()).isZero();
    assertThat(directory.find("acme")).hasValueSatisfying(t -> assertThat(t.ativo()).isTrue());
  }

  @Test
  void cargaInicialCodificaOCursorNaUrl() throws Exception {
    List<String> queries = new CopyOnWriteArrayList<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/api/v1/tenants",
        exchange -> {
          String raw = exchange.getRequestURI().getRawQuery();
          queries.add(raw);
          String body =
              raw.contains("cursor=")
                  ? "{\"itens\":[{\"id\":\"globex\",\"nome\":\"Globex\",\"plano\":\"GRATUITO\","
                      + "\"nivelIsolamento\":\"POOL\",\"ativo\":true,\"versao\":1}],"
                      + "\"proximoCursor\":null}"
                  : "{\"itens\":[{\"id\":\"acme\",\"nome\":\"ACME\",\"plano\":\"PROFISSIONAL\","
                      + "\"nivelIsolamento\":\"POOL\",\"ativo\":true,\"versao\":0}],"
                      + "\"proximoCursor\":\"a+b/c=\"}";
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, bytes.length);
          exchange.getResponseBody().write(bytes);
          exchange.close();
        });
    server.start();
    try {
      var directory = new TenantDirectory();
      URI url = URI.create("http://127.0.0.1:" + server.getAddress().getPort());

      loader(directory, mock(EventDecoder.class), url).loadAll();

      assertThat(queries).containsExactly("limite=100", "limite=100&cursor=a%2Bb%2Fc%3D");
      assertThat(directory.all()).extracting(TenantInfo::id).containsExactly("acme", "globex");
    } finally {
      server.stop(0);
    }
  }
}
