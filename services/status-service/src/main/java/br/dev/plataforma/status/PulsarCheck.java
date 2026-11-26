package br.dev.plataforma.status;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.TimeUnit;

/**
 * Verifica o Pulsar pelo endpoint de health do broker ({@code /admin/v2/brokers/health}), que
 * produz e consome uma mensagem num tópico interno: se responde 200, o broker e o BookKeeper estão
 * funcionando.
 */
public class PulsarCheck implements ComponentCheck, AutoCloseable {

  static final String HEALTH_PATH = "admin/v2/brokers/health";

  private final String name;
  private final URI healthUri;
  private final Duration timeout;
  private final HttpClient http;

  public PulsarCheck(String name, URI adminUrl, Duration timeout) {
    this(name, adminUrl, timeout, HttpClient.newBuilder().connectTimeout(timeout).build());
  }

  PulsarCheck(String name, URI adminUrl, Duration timeout, HttpClient http) {
    this.name = name;
    String base = adminUrl.toString().endsWith("/") ? adminUrl.toString() : adminUrl + "/";
    this.healthUri = URI.create(base).resolve(HEALTH_PATH);
    this.timeout = timeout;
    this.http = http;
  }

  @Override
  public String name() {
    return name;
  }

  @Override
  public ComponentType type() {
    return ComponentType.PULSAR;
  }

  URI healthUri() {
    return healthUri;
  }

  @Override
  public ComponentStatus check() {
    long start = System.nanoTime();
    HttpRequest request = HttpRequest.newBuilder(healthUri).timeout(timeout).GET().build();
    try {
      HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() == 200) {
        return ComponentStatus.up(name, ComponentType.PULSAR, elapsed(start), "broker saudável");
      }
      return ComponentStatus.down(
          name, ComponentType.PULSAR, elapsed(start), "HTTP " + response.statusCode());
    } catch (IOException e) {
      return ComponentStatus.down(
          name, ComponentType.PULSAR, elapsed(start), e.getClass().getSimpleName());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return ComponentStatus.down(name, ComponentType.PULSAR, elapsed(start), "interrompido");
    }
  }

  private static long elapsed(long start) {
    return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
  }

  /** Libera o seletor e o pool de conexões do {@link HttpClient}. */
  @Override
  public void close() {
    http.close();
  }
}
