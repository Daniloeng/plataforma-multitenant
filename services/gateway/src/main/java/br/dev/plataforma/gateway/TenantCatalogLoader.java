package br.dev.plataforma.gateway;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.contracts.tenants.TenantAlterado;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import br.dev.plataforma.spring.events.EventDecoder;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.apache.pulsar.client.api.Consumer;
import org.apache.pulsar.client.api.Message;
import org.apache.pulsar.client.api.PulsarClient;
import org.apache.pulsar.client.api.Schema;
import org.apache.pulsar.client.api.SubscriptionInitialPosition;
import org.apache.pulsar.client.api.SubscriptionMode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;

/**
 * Mantém o {@link TenantDirectory} atualizado: consome {@code tenant.criado} e {@code
 * tenant.alterado} desde o início da retenção (assinatura não durável, uma por réplica: cada
 * gateway precisa de todos os eventos) e carrega a listagem completa do tenant-service para os
 * tenants mais antigos que a retenção. A ordem entre as duas fontes não importa: vence a maior
 * {@code versao}.
 */
public class TenantCatalogLoader implements SmartLifecycle {

  private static final Logger LOG = LoggerFactory.getLogger(TenantCatalogLoader.class);

  private final TenantDirectory directory;
  private final PulsarClient pulsar;
  private final EventDecoder decoder;
  private final EventCatalog catalog;
  private final GatewayProperties props;
  private final ObjectMapper json;
  private final HttpClient http = HttpClient.newHttpClient();
  private final AtomicLong discarded = new AtomicLong();
  private volatile boolean running;
  private Thread events;
  private Thread bootstrap;

  public TenantCatalogLoader(
      TenantDirectory directory,
      PulsarClient pulsar,
      EventDecoder decoder,
      EventCatalog catalog,
      GatewayProperties props,
      ObjectMapper json) {
    this.directory = directory;
    this.pulsar = pulsar;
    this.decoder = decoder;
    this.catalog = catalog;
    this.props = props;
    this.json = json;
  }

  @Override
  public void start() {
    running = true;
    events = Thread.ofVirtual().name("tenant-events").start(this::consumeEvents);
    bootstrap = Thread.ofVirtual().name("tenant-bootstrap").start(this::bootstrapUntilLoaded);
  }

  @Override
  public void stop() {
    running = false;
    if (events != null) {
      events.interrupt();
    }
    if (bootstrap != null) {
      bootstrap.interrupt();
    }
    http.close();
  }

  @Override
  public boolean isRunning() {
    return running;
  }

  void consumeEvents() {
    String criado = catalog.of(TenantCriado.class).topic();
    String alterado = catalog.of(TenantAlterado.class).topic();
    while (running) {
      try (Consumer<byte[]> consumer =
          pulsar
              .newConsumer(Schema.BYTES)
              .topics(List.of(criado, alterado))
              .subscriptionName("gateway-" + UUID.randomUUID())
              .subscriptionMode(SubscriptionMode.NonDurable)
              .subscriptionInitialPosition(SubscriptionInitialPosition.Earliest)
              .subscribe()) {
        while (running) {
          Message<byte[]> msg = consumer.receive(1, TimeUnit.SECONDS);
          if (msg != null) {
            handleSafely(msg, criado);
            consumer.acknowledge(msg);
          }
        }
      } catch (Exception e) {
        if (!running) {
          return;
        }
        LOG.warn("Falha ao consumir eventos de tenant; reconectando", e);
        sleep(Duration.ofSeconds(2));
      }
    }
  }

  /**
   * Uma mensagem ilegível é descartada com log: sem isso ela voltaria para sempre e travaria todos
   * os eventos de tenant que vieram depois dela.
   */
  void handleSafely(Message<byte[]> msg, String criadoTopic) {
    try {
      handle(msg, criadoTopic);
    } catch (RuntimeException e) {
      discarded.incrementAndGet();
      LOG.error(
          "Evento de tenant descartado (tópico {}, id {}): {}",
          msg.getTopicName(),
          msg.getMessageId(),
          e.toString());
    }
  }

  /** Quantos eventos ilegíveis foram descartados desde que o gateway subiu. */
  long discardedEvents() {
    return discarded.get();
  }

  void handle(Message<byte[]> msg, String criadoTopic) {
    // O nome vem com sufixo de partição em tópicos particionados; compara pelo início.
    if (msg.getTopicName().startsWith(criadoTopic)) {
      TenantCriado e = decoder.decode(msg, TenantCriado.class);
      directory.apply(
          new TenantInfo(
              e.getTenantId(),
              e.getNome(),
              e.getPlano(),
              e.getNivelIsolamento(),
              true,
              e.getVersao()));
    } else {
      TenantAlterado e = decoder.decode(msg, TenantAlterado.class);
      directory.apply(
          new TenantInfo(
              e.getTenantId(),
              e.getNome(),
              e.getPlano(),
              e.getNivelIsolamento(),
              e.getAtivo(),
              e.getVersao()));
    }
  }

  void bootstrapUntilLoaded() {
    while (running && !directory.isLoaded()) {
      try {
        loadAll();
        directory.markLoaded();
        LOG.info("Catálogo de tenants carregado: {} tenants", directory.all().size());
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return;
      } catch (Exception e) {
        LOG.warn("tenant-service indisponível para a carga inicial: {}", e.toString());
        sleep(props.tenants().bootstrapRetry());
      }
    }
  }

  /** Percorre todas as páginas de {@code GET /api/v1/tenants}. */
  void loadAll() throws Exception {
    String cursor = null;
    do {
      String uri =
          props.services().tenants()
              + "/api/v1/tenants?limite=100"
              + (cursor == null
                  ? ""
                  : "&cursor=" + URLEncoder.encode(cursor, StandardCharsets.UTF_8));
      HttpResponse<String> resp =
          http.send(
              HttpRequest.newBuilder(URI.create(uri)).timeout(Duration.ofSeconds(5)).GET().build(),
              HttpResponse.BodyHandlers.ofString());
      if (resp.statusCode() != 200) {
        throw new IllegalStateException("HTTP " + resp.statusCode());
      }
      JsonNode page = json.readTree(resp.body());
      for (JsonNode t : page.path("itens")) {
        directory.apply(
            new TenantInfo(
                t.path("id").asText(),
                t.path("nome").asText(),
                Plano.valueOf(t.path("plano").asText()),
                NivelIsolamento.valueOf(t.path("nivelIsolamento").asText()),
                t.path("ativo").asBoolean(),
                t.path("versao").asLong()));
      }
      JsonNode next = page.path("proximoCursor");
      cursor = next.isNull() || next.isMissingNode() ? null : next.asText();
    } while (cursor != null);
  }

  private void sleep(Duration d) {
    try {
      Thread.sleep(d);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      running = false;
    }
  }
}
