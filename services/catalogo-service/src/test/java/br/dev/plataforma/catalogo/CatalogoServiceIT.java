package br.dev.plataforma.catalogo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.contracts.catalogo.PrecoAlterado;
import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.contracts.tenants.TenantAlterado;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import br.dev.plataforma.spring.idempotency.ProcessedEvent;
import br.dev.plataforma.spring.outbox.AvroCodec;
import br.dev.plataforma.spring.outbox.OutboxMessage;
import br.dev.plataforma.spring.outbox.PulsarEventPublisher;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.avro.specific.SpecificRecord;
import org.apache.pulsar.client.admin.PulsarAdmin;
import org.apache.pulsar.client.api.Consumer;
import org.apache.pulsar.client.api.Message;
import org.apache.pulsar.client.api.PulsarClient;
import org.apache.pulsar.client.api.Schema;
import org.apache.pulsar.client.api.SubscriptionInitialPosition;
import org.apache.pulsar.common.policies.data.TenantInfo;
import org.bson.types.ObjectId;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MongoDBContainer;
import org.testcontainers.containers.PulsarContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * O serviço inteiro pela API HTTP, com MongoDB e Pulsar reais. Os eventos de tenant são publicados
 * como o tenant-service publicaria (com o schema registrado) e consumidos pelo EventSubscriber.
 * Cada teste usa tenants próprios, então a ordem dos testes não importa.
 */
@Testcontainers
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"server.shutdown=immediate", "plataforma.catalogo.limites.GRATUITO=3"})
class CatalogoServiceIT {

  @Container static final MongoDBContainer MONGO = new MongoDBContainer("mongo:8.0");

  @Container
  static final PulsarContainer PULSAR =
      new PulsarContainer(DockerImageName.parse("apachepulsar/pulsar:4.0.7"));

  @DynamicPropertySource
  static void propriedades(DynamicPropertyRegistry registry) {
    registry.add("spring.data.mongodb.uri", () -> MONGO.getReplicaSetUrl("catalogo"));
    registry.add("spring.pulsar.client.service-url", PULSAR::getPulsarBrokerUrl);
    registry.add("spring.pulsar.admin.service-url", PULSAR::getHttpServiceUrl);
  }

  @BeforeAll
  static void criarNamespaces() throws Exception {
    try (PulsarAdmin admin =
        PulsarAdmin.builder().serviceHttpUrl(PULSAR.getHttpServiceUrl()).build()) {
      admin
          .tenants()
          .createTenant(
              "plataforma", TenantInfo.builder().allowedClusters(Set.of("standalone")).build());
      admin.namespaces().createNamespace("plataforma/tenants");
      admin.namespaces().createNamespace("plataforma/catalogo");
    }
  }

  @LocalServerPort int port;
  @Autowired MongoTemplate mongo;
  @Autowired PulsarClient pulsar;

  final HttpClient http = HttpClient.newHttpClient();
  final ObjectMapper json = new ObjectMapper();

  record Resposta(int status, JsonNode corpo) {}

  Resposta chamar(String metodo, String caminho, String tenant, String papel, String corpo)
      throws Exception {
    HttpRequest.Builder req =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + caminho))
            .header("Content-Type", "application/json")
            .header("X-Tenant-Id", tenant)
            .header("X-Usuario", "teste")
            .header("X-Papeis", papel)
            .method(
                metodo,
                corpo == null
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(corpo));
    HttpResponse<String> resp = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
    return new Resposta(
        resp.statusCode(), resp.body().isBlank() ? null : json.readTree(resp.body()));
  }

  Resposta criar(String tenant, String sku, long centavos) throws Exception {
    return chamar(
        "POST",
        "/api/v1/produtos",
        tenant,
        "gestor-tenant",
        "{\"sku\":\""
            + sku
            + "\",\"nome\":\"Produto "
            + sku
            + "\",\"preco\":{\"centavos\":"
            + centavos
            + "}}");
  }

  /** Publica como o tenant-service: bytes Avro com o schema do escritor no tópico do contrato. */
  void publicar(SpecificRecord evento, String tenant) throws Exception {
    var contrato = EventCatalog.defaultCatalog().of(evento.getClass());
    try (var publisher =
        new PulsarEventPublisher(pulsar, EventCatalog.defaultCatalog(), Duration.ofSeconds(10))) {
      publisher.publish(
          new OutboxMessage(
              UUID.randomUUID().toString(),
              tenant,
              contrato.event(),
              contrato.topic(),
              tenant + ":" + tenant,
              AvroCodec.encode(evento),
              evento.getSchema().toString(),
              null,
              Instant.now(),
              new ObjectId().toHexString(),
              null,
              0,
              null));
    }
  }

  TenantCriado tenantCriado(String id, Plano plano, UUID eventId) {
    return TenantCriado.newBuilder()
        .setEventId(eventId)
        .setTenantId(id)
        .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
        .setNome("Tenant " + id)
        .setPlano(plano)
        .setNivelIsolamento(NivelIsolamento.POOL)
        .setVersao(0)
        .build();
  }

  void esperarPlano(String tenant, Plano plano) {
    await()
        .atMost(30, TimeUnit.SECONDS)
        .untilAsserted(
            () -> {
              TenantPlano t = mongo.findById(tenant, TenantPlano.class);
              assertThat(t).isNotNull();
              assertThat(t.getPlano()).isEqualTo(plano);
            });
  }

  @Test
  void criarListarEPublicarPrecoAlterado() throws Exception {
    try (Consumer<byte[]> consumer =
        pulsar
            .newConsumer(Schema.BYTES)
            .topic("persistent://plataforma/catalogo/preco.alterado.v1")
            .subscriptionName("teste-" + UUID.randomUUID())
            .subscriptionInitialPosition(SubscriptionInitialPosition.Latest)
            .subscribe()) {
      Resposta criado = criar("loja-a", "PARAF-10", 1290);
      assertThat(criado.status()).isEqualTo(201);
      assertThat(criado.corpo().get("preco").get("centavos").asLong()).isEqualTo(1290);
      assertThat(criado.corpo().get("preco").get("moeda").asText()).isEqualTo("BRL");
      String id = criado.corpo().get("id").asText();

      Message<byte[]> msg = consumer.receive(30, TimeUnit.SECONDS);
      assertThat(msg).isNotNull();
      PrecoAlterado evento = AvroCodec.decode(msg.getValue(), PrecoAlterado.class);
      assertThat(evento.getTenantId()).isEqualTo("loja-a");
      assertThat(evento.getPrecoCentavos()).isEqualTo(1290);
      assertThat(msg.getKey()).isEqualTo("loja-a:" + id);
      assertThat(evento.getVersao()).isZero();

      Resposta preco =
          chamar(
              "PUT",
              "/api/v1/produtos/" + id + "/preco",
              "loja-a",
              "gestor-tenant",
              "{\"centavos\":1490,\"moeda\":\"BRL\"}");
      assertThat(preco.status()).isEqualTo(200);
      Message<byte[]> segundo = consumer.receive(30, TimeUnit.SECONDS);
      PrecoAlterado novo = AvroCodec.decode(segundo.getValue(), PrecoAlterado.class);
      assertThat(novo.getPrecoCentavos()).isEqualTo(1490);
      assertThat(novo.getVersao()).isEqualTo(1); // versão sobe a cada gravação

      // Mesmo preço de novo: nada muda, nenhum evento.
      chamar(
          "PUT",
          "/api/v1/produtos/" + id + "/preco",
          "loja-a",
          "gestor-tenant",
          "{\"centavos\":1490}");
      assertThat(consumer.receive(2, TimeUnit.SECONDS)).isNull();
    }
  }

  @Test
  void limiteDoPlanoVemDoEventoDeTenant() throws Exception {
    // Sem tenant.criado ainda: vale o plano mais restrito (GRATUITO = 3 neste teste).
    for (int i = 1; i <= 3; i++) {
      assertThat(criar("loja-limite", "SKU-" + i, 100).status()).isEqualTo(201);
    }
    Resposta excedeu = criar("loja-limite", "SKU-4", 100);
    assertThat(excedeu.status()).isEqualTo(409);
    assertThat(excedeu.corpo().get("type").asText()).endsWith("/limite-do-plano");

    UUID eventId = UUID.randomUUID();
    publicar(tenantCriado("loja-limite", Plano.PROFISSIONAL, eventId), "loja-limite");
    esperarPlano("loja-limite", Plano.PROFISSIONAL);
    assertThat(criar("loja-limite", "SKU-4", 100).status()).isEqualTo(201);

    Resposta lista = chamar("GET", "/api/v1/produtos", "loja-limite", "gestor-tenant", null);
    assertThat(lista.corpo().get("limitePlano").asInt()).isEqualTo(500);
    assertThat(lista.corpo().get("plano").asText()).isEqualTo("PROFISSIONAL");
    assertThat(lista.corpo().get("usados").asInt()).isEqualTo(4);

    // Reentrega do mesmo evento não reprocessa; versão antiga fora de ordem é ignorada.
    publicar(tenantCriado("loja-limite", Plano.PROFISSIONAL, eventId), "loja-limite");
    publicar(
        TenantAlterado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId("loja-limite")
            .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
            .setNome("x")
            .setPlano(Plano.EMPRESARIAL)
            .setNivelIsolamento(NivelIsolamento.POOL)
            .setAtivo(true)
            .setVersao(2)
            .build(),
        "loja-limite");
    esperarPlano("loja-limite", Plano.EMPRESARIAL);
    publicar(
        TenantAlterado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId("loja-limite")
            .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
            .setNome("x")
            .setPlano(Plano.GRATUITO)
            .setNivelIsolamento(NivelIsolamento.POOL)
            .setAtivo(true)
            .setVersao(1)
            .build(),
        "loja-limite");
    await()
        .atMost(30, TimeUnit.SECONDS)
        .until(
            () ->
                mongo.count(
                        Query.query(
                            Criteria.where("tenantId")
                                .is("loja-limite")
                                .and("consumer")
                                .is(TenantEventos.ALTERADO)),
                        ProcessedEvent.class)
                    == 2);
    assertThat(mongo.findById("loja-limite", TenantPlano.class).getPlano())
        .isEqualTo(Plano.EMPRESARIAL);
    assertThat(
            mongo.count(
                Query.query(
                    Criteria.where("tenantId")
                        .is("loja-limite")
                        .and("consumer")
                        .is(TenantEventos.CRIADO)),
                ProcessedEvent.class))
        .isEqualTo(1);
  }

  @Test
  void compradorSoLeAtivosENaoAltera() throws Exception {
    String ativo = criar("loja-b", "ATIVO-1", 500).corpo().get("id").asText();
    String inativo = criar("loja-b", "INATIVO-1", 500).corpo().get("id").asText();
    assertThat(
            chamar(
                    "PATCH",
                    "/api/v1/produtos/" + inativo,
                    "loja-b",
                    "gestor-tenant",
                    "{\"ativo\":false}")
                .corpo()
                .get("ativo")
                .asBoolean())
        .isFalse();

    Resposta lista = chamar("GET", "/api/v1/produtos?ativo=false", "loja-b", "comprador", null);
    assertThat(lista.corpo().get("itens").findValuesAsText("id")).containsExactly(ativo);
    assertThat(chamar("GET", "/api/v1/produtos/" + inativo, "loja-b", "comprador", null).status())
        .isEqualTo(404);
    assertThat(
            chamar("GET", "/api/v1/produtos/" + inativo, "loja-b", "gestor-tenant", null).status())
        .isEqualTo(200);
    Resposta gestor =
        chamar("GET", "/api/v1/produtos?ativo=false", "loja-b", "gestor-tenant", null);
    assertThat(gestor.corpo().get("itens").findValuesAsText("id")).containsExactly(inativo);

    Resposta proibido =
        chamar(
            "POST",
            "/api/v1/produtos",
            "loja-b",
            "comprador",
            "{\"sku\":\"NOVO-1\",\"nome\":\"Novo\",\"preco\":{\"centavos\":1}}");
    assertThat(proibido.status()).isEqualTo(403);
    assertThat(proibido.corpo().get("type").asText()).endsWith("/acesso-negado");
    assertThat(
            chamar(
                    "PUT",
                    "/api/v1/produtos/" + ativo + "/preco",
                    "loja-b",
                    "comprador",
                    "{\"centavos\":1}")
                .status())
        .isEqualTo(403);
  }

  @Test
  void tenantNaoEnxergaProdutoDeOutro() throws Exception {
    String id = criar("loja-c", "SECRETO-1", 100).corpo().get("id").asText();
    assertThat(chamar("GET", "/api/v1/produtos/" + id, "loja-d", "gestor-tenant", null).status())
        .isEqualTo(404);
    assertThat(
            chamar(
                    "PATCH",
                    "/api/v1/produtos/" + id,
                    "loja-d",
                    "gestor-tenant",
                    "{\"nome\":\"Roubado\"}")
                .status())
        .isEqualTo(404);
    assertThat(
            chamar("GET", "/api/v1/produtos", "loja-d", "gestor-tenant", null)
                .corpo()
                .get("total")
                .asInt())
        .isZero();
    // O mesmo SKU pode existir em outro tenant.
    assertThat(criar("loja-d", "SECRETO-1", 100).status()).isEqualTo(201);
  }

  @Test
  void skuDuplicadoValidacaoBuscaEPaginacao() throws Exception {
    assertThat(criar("loja-e", "CAFE-1", 100).status()).isEqualTo(201);
    Resposta dup = criar("loja-e", "CAFE-1", 100);
    assertThat(dup.status()).isEqualTo(409);
    assertThat(dup.corpo().get("type").asText()).endsWith("/sku-duplicado");
    criar("loja-e", "CAFE-2", 100);
    criar("loja-e", "ACUCAR-1", 100);

    assertThat(criar("loja-e", "minusculo", 100).status()).isEqualTo(400);
    assertThat(
            chamar(
                    "POST",
                    "/api/v1/produtos",
                    "loja-e",
                    "gestor-tenant",
                    "{\"sku\":\"NEG-1\",\"nome\":\"Neg\",\"preco\":{\"centavos\":-1}}")
                .status())
        .isEqualTo(400);
    assertThat(
            chamar(
                    "POST",
                    "/api/v1/produtos",
                    "loja-e",
                    "gestor-tenant",
                    "{\"sku\":\"ESP-1\",\"nome\":\"  a  \",\"preco\":{\"centavos\":1}}")
                .status())
        .isEqualTo(400);

    Resposta busca = chamar("GET", "/api/v1/produtos?busca=cafe", "loja-e", "comprador", null);
    assertThat(busca.corpo().get("itens").findValuesAsText("sku"))
        .containsExactly("CAFE-1", "CAFE-2");
    assertThat(busca.corpo().get("total").asInt()).isEqualTo(2);
    // Busca com caractere especial de regex não quebra nem casa tudo.
    assertThat(
            chamar("GET", "/api/v1/produtos?busca=.*", "loja-e", "comprador", null)
                .corpo()
                .get("total")
                .asInt())
        .isZero();

    Resposta p1 = chamar("GET", "/api/v1/produtos?limite=2", "loja-e", "comprador", null);
    assertThat(p1.corpo().get("itens").findValuesAsText("sku"))
        .containsExactly("ACUCAR-1", "CAFE-1");
    String cursor = p1.corpo().get("proximoCursor").asText();
    Resposta p2 =
        chamar("GET", "/api/v1/produtos?limite=2&cursor=" + cursor, "loja-e", "comprador", null);
    assertThat(p2.corpo().get("itens").findValuesAsText("sku")).containsExactly("CAFE-2");
    assertThat(p2.corpo().get("proximoCursor").isNull()).isTrue();

    assertThat(chamar("GET", "/api/v1/produtos?limite=0", "loja-e", "comprador", null).status())
        .isEqualTo(400);
    assertThat(chamar("GET", "/api/v1/produtos?cursor=@@@", "loja-e", "comprador", null).status())
        .isEqualTo(400);
    assertThat(chamar("GET", "/api/v1/produtos", "LOJA!", "comprador", null).status())
        .isEqualTo(400);
  }

  @Test
  void patchSemMudancaNaoGravaEPatchVazioDa400() throws Exception {
    String id = criar("loja-f", "MESMO-1", 100).corpo().get("id").asText();
    Resposta igual =
        chamar(
            "PATCH",
            "/api/v1/produtos/" + id,
            "loja-f",
            "gestor-tenant",
            "{\"nome\":\"Produto MESMO-1\"}");
    assertThat(igual.status()).isEqualTo(200);
    assertThat(igual.corpo().get("atualizadoEm").asText())
        .isEqualTo(igual.corpo().get("criadoEm").asText());
    assertThat(chamar("PATCH", "/api/v1/produtos/" + id, "loja-f", "gestor-tenant", "{}").status())
        .isEqualTo(400);
    assertThat(
            chamar(
                    "PATCH",
                    "/api/v1/produtos/" + id,
                    "loja-f",
                    "plataforma-admin",
                    "{\"nome\":\"Novo nome\"}")
                .corpo()
                .get("nome")
                .asText())
        .isEqualTo("Novo nome");
    assertThat(chamar("POST", "/api/v1/produtos", "loja-f", "gestor-tenant", "{json ruim").status())
        .isEqualTo(400);
  }

  @Test
  void tenantSuspensoNaoAlteraOCatalogo() throws Exception {
    String id = criar("loja-g", "ANTES-1", 100).corpo().get("id").asText();
    publicar(
        TenantAlterado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId("loja-g")
            .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
            .setNome("Loja G")
            .setPlano(Plano.PROFISSIONAL)
            .setNivelIsolamento(NivelIsolamento.POOL)
            .setAtivo(false)
            .setVersao(1)
            .build(),
        "loja-g");
    esperarPlano("loja-g", Plano.PROFISSIONAL);

    Resposta novo = criar("loja-g", "DEPOIS-1", 100);
    assertThat(novo.status()).isEqualTo(403);
    assertThat(novo.corpo().get("type").asText()).endsWith("/tenant-suspenso");
    assertThat(
            chamar(
                    "PUT",
                    "/api/v1/produtos/" + id + "/preco",
                    "loja-g",
                    "gestor-tenant",
                    "{\"centavos\":5}")
                .status())
        .isEqualTo(403);
    assertThat(
            chamar(
                    "PATCH",
                    "/api/v1/produtos/" + id,
                    "loja-g",
                    "gestor-tenant",
                    "{\"ativo\":false}")
                .status())
        .isEqualTo(403);
    // Leitura continua.
    assertThat(chamar("GET", "/api/v1/produtos/" + id, "loja-g", "comprador", null).status())
        .isEqualTo(200);
  }
}
