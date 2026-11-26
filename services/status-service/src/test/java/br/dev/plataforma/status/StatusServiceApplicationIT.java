package br.dev.plataforma.status;

import static org.assertj.core.api.Assertions.assertThat;

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

  @DynamicPropertySource
  static void propriedades(DynamicPropertyRegistry registry) {
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
    assertThat(status.components()).hasSize(5);
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
