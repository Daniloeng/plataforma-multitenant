package br.dev.plataforma.status;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MongoDBContainer;
import org.testcontainers.containers.PulsarContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Sobe o serviço inteiro contra um MongoDB e um Pulsar reais (Testcontainers) e confere a resposta
 * de /api/status de ponta a ponta.
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class StatusServiceApplicationIT {

  @Container static final MongoDBContainer MONGO = new MongoDBContainer("mongo:8.0");

  @Container
  static final PulsarContainer PULSAR =
      new PulsarContainer(DockerImageName.parse("apachepulsar/pulsar:4.0.7"));

  /** Faz o papel do tenant-service: só a readiness do Actuator. */
  static final HttpServer TENANT_SERVICE = iniciarTenantServiceFalso();

  static HttpServer iniciarTenantServiceFalso() {
    try {
      HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext(
          "/actuator/health/readiness",
          exchange -> {
            byte[] body = "{\"status\":\"UP\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
          });
      server.start();
      return server;
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @AfterAll
  static void pararTenantServiceFalso() {
    TENANT_SERVICE.stop(0);
  }

  @DynamicPropertySource
  static void propriedades(DynamicPropertyRegistry registry) {
    registry.add("plataforma.status.services[0].name", () -> "tenant-service");
    registry.add(
        "plataforma.status.services[0].url",
        () -> "http://127.0.0.1:" + TENANT_SERVICE.getAddress().getPort());
    String[] nomes = {"tenants", "catalogo", "pedidos", "pagamentos"};
    for (int i = 0; i < nomes.length; i++) {
      String nome = "mongo-" + nomes[i];
      registry.add("plataforma.status.mongo[" + i + "].name", () -> nome);
      registry.add("plataforma.status.mongo[" + i + "].uri", MONGO::getReplicaSetUrl);
    }
    registry.add("plataforma.status.pulsar.admin-url", PULSAR::getHttpServiceUrl);
  }

  @Autowired private TestRestTemplate rest;

  @Test
  void plataformaFicaUpComInfraestruturaReal() {
    ResponseEntity<PlatformStatus> resposta =
        rest.getForEntity("/api/status", PlatformStatus.class);

    assertThat(resposta.getStatusCode()).isEqualTo(HttpStatus.OK);
    PlatformStatus status = resposta.getBody();
    assertThat(status).isNotNull();
    assertThat(status.components()).hasSize(6);
    assertThat(status.components())
        .filteredOn(c -> c.type() == ComponentType.SERVICE)
        .extracting(ComponentStatus::name)
        .containsExactly("tenant-service");
    assertThat(status.components())
        .allSatisfy(c -> assertThat(c.status()).as(c.name()).isEqualTo(HealthState.UP));
    assertThat(status.status()).isEqualTo(HealthState.UP);
  }

  @Test
  void actuatorExpoeProbes() {
    ResponseEntity<String> resposta = rest.getForEntity("/actuator/health/readiness", String.class);
    assertThat(resposta.getStatusCode()).isEqualTo(HttpStatus.OK);
  }
}
