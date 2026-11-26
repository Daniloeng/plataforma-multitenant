package br.dev.plataforma.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.contracts.tenants.TenantAlterado;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import br.dev.plataforma.spring.outbox.AvroBytesSchema;
import br.dev.plataforma.spring.outbox.AvroCodec;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.UUID;
import org.apache.avro.specific.SpecificRecord;
import org.apache.pulsar.client.admin.PulsarAdmin;
import org.apache.pulsar.client.api.Producer;
import org.apache.pulsar.client.api.PulsarClient;
import org.apache.pulsar.common.policies.data.TenantInfo;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.BindMode;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PulsarContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Ponta a ponta com o realm real do Keycloak ({@code infra/keycloak/realm-plataforma.json}): tokens
 * de verdade, catálogo de tenants vindo da listagem inicial e dos eventos do Pulsar, e um serviço
 * falso atrás do gateway.
 */
@Testcontainers
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "server.shutdown=immediate",
      "plataforma.gateway.tenants.bootstrap-retry=200ms",
      "plataforma.gateway.limits.GRATUITO.per-second=1",
      "plataforma.gateway.limits.GRATUITO.burst=5"
    })
class GatewayKeycloakIT {

  static final Path REALM = Path.of("../../infra/keycloak/realm-plataforma.json").toAbsolutePath();

  @Container
  static final GenericContainer<?> KEYCLOAK =
      new GenericContainer<>(DockerImageName.parse("keycloak/keycloak:26.4.7"))
          .withExposedPorts(8080)
          .withFileSystemBind(
              REALM.toString(), "/opt/keycloak/data/import/realm.json", BindMode.READ_ONLY)
          .withCommand("start-dev", "--import-realm")
          .waitingFor(
              Wait.forHttp("/realms/plataforma/.well-known/openid-configuration")
                  .withStartupTimeout(Duration.ofMinutes(3)));

  @Container
  static final PulsarContainer PULSAR =
      new PulsarContainer(DockerImageName.parse("apachepulsar/pulsar:4.0.7"));

  static final BackendStub BACKEND = new BackendStub();

  static String keycloakUrl() {
    return "http://localhost:" + KEYCLOAK.getMappedPort(8080);
  }

  @DynamicPropertySource
  static void propriedades(DynamicPropertyRegistry registry) {
    // Sem KC_HOSTNAME, o emissor é o endereço usado na chamada: o mesmo para token e chaves.
    registry.add("plataforma.gateway.issuer", () -> keycloakUrl() + "/realms/plataforma");
    registry.add(
        "plataforma.gateway.jwk-set-uri",
        () -> keycloakUrl() + "/realms/plataforma/protocol/openid-connect/certs");
    registry.add("spring.pulsar.client.service-url", PULSAR::getPulsarBrokerUrl);
    registry.add("spring.pulsar.admin.service-url", PULSAR::getHttpServiceUrl);
    registry.add("plataforma.gateway.services.tenants", BACKEND::url);
    registry.add("plataforma.gateway.services.status", BACKEND::url);
  }

  @BeforeAll
  static void preparar() throws Exception {
    // A listagem inicial do tenant-service traz globex; acme chega só por evento.
    BACKEND.tenantsPage =
        "{\"itens\":[{\"id\":\"globex\",\"nome\":\"Globex\",\"plano\":\"EMPRESARIAL\","
            + "\"nivelIsolamento\":\"POOL\",\"ativo\":true,\"versao\":2}],\"proximoCursor\":null}";
    try (PulsarAdmin admin =
        PulsarAdmin.builder().serviceHttpUrl(PULSAR.getHttpServiceUrl()).build()) {
      admin
          .tenants()
          .createTenant(
              "plataforma", TenantInfo.builder().allowedClusters(Set.of("standalone")).build());
      admin.namespaces().createNamespace("plataforma/tenants");
    }
  }

  @AfterAll
  static void parar() {
    BACKEND.close();
  }

  @LocalServerPort int port;
  @Autowired PulsarClient pulsar;
  @Autowired TenantDirectory directory;

  final HttpClient http = HttpClient.newHttpClient();
  final ObjectMapper json = new ObjectMapper();

  String token(String usuario) throws Exception {
    String form =
        "grant_type=password&client_id=plataforma-cli&username="
            + URLEncoder.encode(usuario, StandardCharsets.UTF_8)
            + "&password=senha123";
    HttpResponse<String> resp =
        http.send(
            HttpRequest.newBuilder(
                    URI.create(keycloakUrl() + "/realms/plataforma/protocol/openid-connect/token"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build(),
            HttpResponse.BodyHandlers.ofString());
    assertThat(resp.statusCode()).as(resp.body()).isEqualTo(200);
    return json.readTree(resp.body()).get("access_token").asText();
  }

  HttpResponse<String> get(String path, String token, String tenant) throws Exception {
    HttpRequest.Builder req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (token != null) {
      req.header("Authorization", "Bearer " + token);
    }
    if (tenant != null) {
      req.header("X-Tenant-Id", tenant);
    }
    return http.send(req.GET().build(), HttpResponse.BodyHandlers.ofString());
  }

  void publicar(SpecificRecord evento) throws Exception {
    var contrato = EventCatalog.defaultCatalog().of(evento.getClass());
    try (Producer<byte[]> producer =
        pulsar
            .newProducer(new AvroBytesSchema(contrato.schema()))
            .topic(contrato.topic())
            .create()) {
      producer.send(AvroCodec.encode(evento));
    }
  }

  static Instant agora() {
    return Instant.now().truncatedTo(ChronoUnit.MILLIS);
  }

  @Test
  void fluxoCompletoComTokensReaisCatalogoPorEventoELimiteDoPlano() throws Exception {
    publicar(
        TenantCriado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId("acme")
            .setOccurredAt(agora())
            .setNome("ACME Ltda")
            .setPlano(Plano.GRATUITO)
            .setNivelIsolamento(NivelIsolamento.POOL)
            .build());
    await()
        .atMost(Duration.ofSeconds(30))
        .until(() -> directory.find("acme").isPresent() && directory.isLoaded());

    String bruno = token("bruno");
    String admin = token("admin");

    // Token inválido
    assertThat(get("/api/v1/me", "x.y.z", null).statusCode()).isEqualTo(401);

    // /me do comprador: um tenant só (acme), escolhido sozinho, com cliente do token
    HttpResponse<String> me = get("/api/v1/me", bruno, null);
    assertThat(me.statusCode()).as(me.body()).isEqualTo(200);
    JsonNode corpo = json.readTree(me.body());
    assertThat(corpo.get("usuario").asText()).isEqualTo("bruno");
    assertThat(corpo.get("clienteId").asText()).isEqualTo("cli-bruno");
    assertThat(corpo.get("papeis").toString()).isEqualTo("[\"comprador\"]");
    assertThat(corpo.get("tenants").get(0).get("nome").asText()).isEqualTo("ACME Ltda");

    // Admin vê os dois: um veio da listagem, outro do evento
    JsonNode doAdmin = json.readTree(get("/api/v1/me", admin, null).body());
    assertThat(doAdmin.get("tenants").findValuesAsText("id")).containsExactly("acme", "globex");

    // API administrativa: só admin, e o serviço recebe a identidade verificada
    assertThat(get("/api/v1/tenants", bruno, null).statusCode()).isEqualTo(403);
    assertThat(get("/api/v1/tenants/acme", admin, null).statusCode()).isEqualTo(200);
    assertThat(BACKEND.lastHeaders).containsEntry("X-Usuario", "admin");

    // Limite do plano GRATUITO (neste teste: rajada de 5); já gastamos 1 com o /me do bruno
    int recusadas = 0;
    for (int i = 0; i < 8; i++) {
      if (get("/api/v1/me", bruno, "acme").statusCode() == 429) {
        recusadas++;
      }
    }
    assertThat(recusadas).isGreaterThanOrEqualTo(3);

    // tenant.alterado (versao 1) suspende o tenant; um tenant.criado atrasado (versao 0) não
    // reativa
    publicar(
        TenantAlterado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId("acme")
            .setOccurredAt(agora())
            .setNome("ACME Ltda")
            .setPlano(Plano.GRATUITO)
            .setNivelIsolamento(NivelIsolamento.POOL)
            .setAtivo(false)
            .setVersao(1)
            .build());
    await().atMost(Duration.ofSeconds(30)).until(() -> !directory.find("acme").get().ativo());
    HttpResponse<String> suspenso = get("/api/v1/me", bruno, "acme");
    assertThat(suspenso.statusCode()).isEqualTo(403);
    assertThat(suspenso.body()).contains("tenant-suspenso");
  }
}
