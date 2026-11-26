package br.dev.plataforma.status;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ServiceCheckTest {

  private static final Duration TIMEOUT = Duration.ofSeconds(1);

  private HttpServer server;
  private final AtomicInteger codigo = new AtomicInteger(200);

  @BeforeEach
  void iniciarServidor() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/actuator/health/readiness",
        exchange -> {
          byte[] body = "ok".getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(codigo.get(), body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
  }

  @AfterEach
  void pararServidor() {
    server.stop(0);
  }

  private URI adminUrl() {
    return URI.create("http://127.0.0.1:" + server.getAddress().getPort());
  }

  @Test
  void servicoProntoDaUp() {
    var check = new ServiceCheck("tenant-service", adminUrl(), TIMEOUT);

    ComponentStatus status = check.check();

    assertThat(status.status()).isEqualTo(HealthState.UP);
    assertThat(status.type()).isEqualTo(ComponentType.SERVICE);
    assertThat(status.name()).isEqualTo("tenant-service");
    assertThat(status.details()).isEqualTo("readiness UP");
    assertThat(check.type()).isEqualTo(ComponentType.SERVICE);
    assertThat(check.name()).isEqualTo("tenant-service");
  }

  @Test
  void respostaDeErroDaDownComCodigoHttp() {
    codigo.set(503);

    ComponentStatus status = new ServiceCheck("tenant-service", adminUrl(), TIMEOUT).check();

    assertThat(status.status()).isEqualTo(HealthState.DOWN);
    assertThat(status.details()).isEqualTo("HTTP 503");
  }

  @Test
  void servicoInacessivelDaDown() throws IOException {
    int portaLivre;
    try (ServerSocket socket = new ServerSocket(0)) {
      portaLivre = socket.getLocalPort();
    }

    ComponentStatus status =
        new ServiceCheck("tenant-service", URI.create("http://127.0.0.1:" + portaLivre), TIMEOUT)
            .check();

    assertThat(status.status()).isEqualTo(HealthState.DOWN);
    assertThat(status.details()).isEqualTo("ConnectException");
  }

  @Test
  void montaUrlDeHealthComOuSemBarraFinal() {
    assertThat(new ServiceCheck("t", URI.create("http://tenant-service:8081"), TIMEOUT).healthUri())
        .hasToString("http://tenant-service:8081/actuator/health/readiness");
    assertThat(
            new ServiceCheck("t", URI.create("http://tenant-service:8081/"), TIMEOUT).healthUri())
        .hasToString("http://tenant-service:8081/actuator/health/readiness");
  }

  @Test
  void closeFechaOHttpClient() {
    HttpClient http = mock(HttpClient.class);
    new ServiceCheck("tenant-service", adminUrl(), TIMEOUT, http).close();
    org.mockito.Mockito.verify(http).close();
  }

  @Test
  @SuppressWarnings("unchecked")
  void interrupcaoDaDownEPreservaFlag() throws Exception {
    HttpClient http = mock(HttpClient.class);
    when(http.send(any(), any(HttpResponse.BodyHandler.class)))
        .thenThrow(new InterruptedException());
    var check = new ServiceCheck("tenant-service", adminUrl(), TIMEOUT, http);

    try {
      ComponentStatus status = check.check();
      assertThat(status.status()).isEqualTo(HealthState.DOWN);
      assertThat(status.details()).isEqualTo("interrompido");
      assertThat(Thread.currentThread().isInterrupted()).isTrue();
    } finally {
      Thread.interrupted();
    }
  }

  @Test
  void aceitaCaminhoDeSaudeProprio() {
    assertThat(
            new ServiceCheck(
                    "keycloak", URI.create("http://keycloak:9000"), "health/ready", TIMEOUT)
                .healthUri())
        .hasToString("http://keycloak:9000/health/ready");
  }

  @Test
  void alvoSemCaminhoUsaAReadinessDoActuator() {
    URI url = URI.create("http://x:1");
    assertThat(new StatusProperties.ServiceTarget("x", url, null).healthPath())
        .isEqualTo(ServiceCheck.HEALTH_PATH);
    assertThat(new StatusProperties.ServiceTarget("x", url, " ").healthPath())
        .isEqualTo(ServiceCheck.HEALTH_PATH);
    assertThat(new StatusProperties.ServiceTarget("x", url, "health/ready").healthPath())
        .isEqualTo("health/ready");
  }
}
