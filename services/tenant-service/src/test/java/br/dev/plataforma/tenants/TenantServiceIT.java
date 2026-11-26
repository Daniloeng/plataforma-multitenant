package br.dev.plataforma.tenants;

import static org.assertj.core.api.Assertions.assertThat;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.contracts.tenants.TenantAlterado;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import br.dev.plataforma.spring.outbox.AvroCodec;
import br.dev.plataforma.spring.outbox.OutboxMessage;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.pulsar.client.admin.PulsarAdmin;
import org.apache.pulsar.client.api.Consumer;
import org.apache.pulsar.client.api.Message;
import org.apache.pulsar.client.api.PulsarClient;
import org.apache.pulsar.client.api.Schema;
import org.apache.pulsar.client.api.SubscriptionInitialPosition;
import org.apache.pulsar.common.policies.data.TenantInfo;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MongoDBContainer;
import org.testcontainers.containers.PulsarContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/** O serviço inteiro pela API HTTP, com MongoDB (replica set) e Pulsar reais. */
@Testcontainers
// shutdown imediato: no graceful, conexões keep-alive do HttpClient seguram o fim da JVM por 30 s.
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "server.shutdown=immediate")
class TenantServiceIT {

  @Container static final MongoDBContainer MONGO = new MongoDBContainer("mongo:8.0");

  @Container
  static final PulsarContainer PULSAR =
      new PulsarContainer(DockerImageName.parse("apachepulsar/pulsar:4.0.7"));

  @DynamicPropertySource
  static void propriedades(DynamicPropertyRegistry registry) {
    registry.add("spring.data.mongodb.uri", () -> MONGO.getReplicaSetUrl("tenants"));
    registry.add("spring.pulsar.client.service-url", PULSAR::getPulsarBrokerUrl);
  }

  @BeforeAll
  static void criarNamespace() throws Exception {
    try (PulsarAdmin admin =
        PulsarAdmin.builder().serviceHttpUrl(PULSAR.getHttpServiceUrl()).build()) {
      admin
          .tenants()
          .createTenant(
              "plataforma", TenantInfo.builder().allowedClusters(Set.of("standalone")).build());
      admin.namespaces().createNamespace("plataforma/tenants");
    }
  }

  @LocalServerPort int port;
  @Autowired MongoTemplate mongo;
  @Autowired PulsarClient pulsar;

  final HttpClient http = HttpClient.newHttpClient();
  final ObjectMapper json = new ObjectMapper();

  @BeforeEach
  void limpar() {
    mongo.remove(new Query(), TenantDocument.class);
    mongo.remove(new Query(), OutboxMessage.class);
  }

  record Resposta(int status, JsonNode corpo, HttpResponse<String> bruta) {}

  Resposta chamar(String metodo, String caminho, String corpo) throws Exception {
    HttpRequest.Builder req =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + caminho))
            .header("Content-Type", "application/json")
            .method(
                metodo,
                corpo == null
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(corpo));
    HttpResponse<String> resp = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
    JsonNode node = resp.body().isBlank() ? null : json.readTree(resp.body());
    return new Resposta(resp.statusCode(), node, resp);
  }

  Resposta criar(String id, String plano) throws Exception {
    return chamar(
        "POST",
        "/api/v1/tenants",
        "{\"id\":\"" + id + "\",\"nome\":\"  Empresa " + id + " \",\"plano\":\"" + plano + "\"}");
  }

  @Test
  // Latest: o consumidor assina antes da ação e ignora eventos de outros testes.
  void criarConsultarEPublicarTenantCriado() throws Exception {
    try (Consumer<byte[]> consumer =
        pulsar
            .newConsumer(Schema.BYTES)
            .topic("persistent://plataforma/tenants/tenant.criado.v1")
            .subscriptionName("teste-" + UUID.randomUUID())
            .subscriptionInitialPosition(SubscriptionInitialPosition.Latest)
            .subscribe()) {

      Resposta criado = criar("acme", "PROFISSIONAL");

      assertThat(criado.status()).isEqualTo(201);
      assertThat(criado.bruta().headers().firstValue("Location")).hasValue("/api/v1/tenants/acme");
      assertThat(criado.corpo().get("nome").asText()).isEqualTo("Empresa acme");
      assertThat(criado.corpo().get("nivelIsolamento").asText()).isEqualTo("POOL");
      assertThat(criado.corpo().get("ativo").asBoolean()).isTrue();
      assertThat(criado.corpo().has("version")).isFalse();

      Resposta lido = chamar("GET", "/api/v1/tenants/acme", null);
      assertThat(lido.status()).isEqualTo(200);
      assertThat(lido.corpo().get("plano").asText()).isEqualTo("PROFISSIONAL");

      // O relay (ciclo de 200 ms) leva o evento do outbox ao Pulsar.
      Message<byte[]> msg = consumer.receive(20, TimeUnit.SECONDS);
      assertThat(msg).isNotNull();
      assertThat(msg.getKey()).isEqualTo("acme:acme");
      TenantCriado evento = AvroCodec.decode(msg.getValue(), TenantCriado.class);
      assertThat(evento.getTenantId()).isEqualTo("acme");
      assertThat(evento.getPlano()).isEqualTo(Plano.PROFISSIONAL);
      consumer.acknowledge(msg);
    }
  }

  @Test
  void alterarPublicaTenantAlteradoECamposNulosNaoMudam() throws Exception {
    criar("beta", "GRATUITO");
    try (Consumer<byte[]> consumer =
        pulsar
            .newConsumer(Schema.BYTES)
            .topic("persistent://plataforma/tenants/tenant.alterado.v1")
            .subscriptionName("teste-" + UUID.randomUUID())
            .subscriptionInitialPosition(SubscriptionInitialPosition.Latest)
            .subscribe()) {

      Resposta alterado =
          chamar("PATCH", "/api/v1/tenants/beta", "{\"ativo\":false,\"nivelIsolamento\":\"SILO\"}");

      assertThat(alterado.status()).isEqualTo(200);
      assertThat(alterado.corpo().get("ativo").asBoolean()).isFalse();
      assertThat(alterado.corpo().get("nivelIsolamento").asText()).isEqualTo("SILO");
      assertThat(alterado.corpo().get("plano").asText()).isEqualTo("GRATUITO");

      Message<byte[]> msg = consumer.receive(20, TimeUnit.SECONDS);
      assertThat(msg).isNotNull();
      TenantAlterado evento = AvroCodec.decode(msg.getValue(), TenantAlterado.class);
      assertThat(evento.getAtivo()).isFalse();
      assertThat(evento.getNivelIsolamento()).isEqualTo(NivelIsolamento.SILO);
    }

    Resposta renomeado = chamar("PATCH", "/api/v1/tenants/beta", "{\"nome\":\" Beta S.A. \"}");
    assertThat(renomeado.corpo().get("nome").asText()).isEqualTo("Beta S.A.");
    assertThat(renomeado.corpo().get("ativo").asBoolean()).isFalse();
  }

  @Test
  void idRepetidoDa409EmProblemDetailsSemGerarEvento() throws Exception {
    criar("gama", "GRATUITO");

    Resposta repetido = criar("gama", "EMPRESARIAL");

    assertThat(repetido.status()).isEqualTo(409);
    assertThat(repetido.bruta().headers().firstValue("Content-Type"))
        .hasValueSatisfying(v -> assertThat(v).startsWith("application/problem+json"));
    assertThat(repetido.corpo().get("type").asText())
        .isEqualTo("https://plataforma.dev.br/problemas/conflito");
    assertThat(repetido.corpo().get("detail").asText()).contains("gama");
    assertThat(mongo.count(new Query(), OutboxMessage.class)).isEqualTo(1);
  }

  @Test
  void requisicoesInvalidasDao400() throws Exception {
    assertThat(criar("A", "GRATUITO").status()).isEqualTo(400);
    assertThat(criar("ab--cd", "GRATUITO").status()).isEqualTo(400);
    Resposta planoInvalido = criar("valido", "OURO");
    assertThat(planoInvalido.status()).isEqualTo(400);
    assertThat(planoInvalido.corpo().get("type").asText())
        .isEqualTo("https://plataforma.dev.br/problemas/requisicao-invalida");
    Resposta idInvalido = criar("A", "GRATUITO");
    assertThat(idInvalido.corpo().get("detail").asText()).startsWith("id: ");
    assertThat(
            chamar("POST", "/api/v1/tenants", "{\"id\":\"sem-nome\",\"plano\":\"GRATUITO\"}")
                .status())
        .isEqualTo(400);

    criar("delta", "GRATUITO");
    Resposta vazio = chamar("PATCH", "/api/v1/tenants/delta", "{}");
    assertThat(vazio.status()).isEqualTo(400);
    assertThat(vazio.corpo().get("type").asText())
        .isEqualTo("https://plataforma.dev.br/problemas/requisicao-invalida");
    assertThat(chamar("PATCH", "/api/v1/tenants/delta", "{\"nome\":\"   \"}").status())
        .isEqualTo(400);
    assertThat(chamar("GET", "/api/v1/tenants?limite=0", null).status()).isEqualTo(400);
    assertThat(chamar("GET", "/api/v1/tenants?cursor=%25%25", null).status()).isEqualTo(400);
    assertThat(chamar("GET", "/api/v1/tenants/X", null).status()).isEqualTo(400);
  }

  @Test
  void inexistenteDa404() throws Exception {
    Resposta r = chamar("GET", "/api/v1/tenants/nao-existe", null);
    assertThat(r.status()).isEqualTo(404);
    assertThat(r.corpo().get("title").asText()).isEqualTo("Tenant não encontrado");
    assertThat(chamar("PATCH", "/api/v1/tenants/nao-existe", "{\"ativo\":true}").status())
        .isEqualTo(404);
  }

  @Test
  void listagemPaginaPorCursorEmOrdemDeId() throws Exception {
    for (String id : List.of("eco", "alfa", "delta", "bravo", "charlie")) {
      criar(id, "GRATUITO");
    }
    List<String> vistos = new ArrayList<>();
    String cursor = null;
    int paginas = 0;
    do {
      Resposta pagina =
          chamar(
              "GET",
              "/api/v1/tenants?limite=2" + (cursor == null ? "" : "&cursor=" + cursor),
              null);
      assertThat(pagina.status()).isEqualTo(200);
      pagina.corpo().get("itens").forEach(t -> vistos.add(t.get("id").asText()));
      JsonNode proximo = pagina.corpo().get("proximoCursor");
      cursor = proximo == null || proximo.isNull() ? null : proximo.asText();
      paginas++;
    } while (cursor != null);

    assertThat(vistos).containsExactly("alfa", "bravo", "charlie", "delta", "eco");
    assertThat(paginas).isEqualTo(3);
  }

  @Test
  void apiAdministrativaNaoExigeXTenantIdEHealthResponde() throws Exception {
    assertThat(chamar("GET", "/api/v1/tenants", null).status()).isEqualTo(200);
    Resposta health = chamar("GET", "/actuator/health/readiness", null);
    assertThat(health.status()).isEqualTo(200);
    assertThat(health.corpo().get("status").asText()).isEqualTo("UP");
  }
}
