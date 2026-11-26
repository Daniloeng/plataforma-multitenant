package br.dev.plataforma.status;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.TimeUnit;

/** Verificação por HTTP: o componente está UP se o endpoint de saúde responde 200. */
abstract class HttpHealthCheck implements ComponentCheck, AutoCloseable {

  private final String name;
  private final ComponentType type;
  private final URI healthUri;
  private final String upDetail;
  private final Duration timeout;
  private final HttpClient http;

  HttpHealthCheck(
      String name,
      ComponentType type,
      URI baseUrl,
      String healthPath,
      String upDetail,
      Duration timeout,
      HttpClient http) {
    this.name = name;
    this.type = type;
    String base = baseUrl.toString().endsWith("/") ? baseUrl.toString() : baseUrl + "/";
    this.healthUri = URI.create(base).resolve(healthPath);
    this.upDetail = upDetail;
    this.timeout = timeout;
    this.http = http;
  }

  static HttpClient newClient(Duration timeout) {
    return HttpClient.newBuilder().connectTimeout(timeout).build();
  }

  @Override
  public String name() {
    return name;
  }

  @Override
  public ComponentType type() {
    return type;
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
        return ComponentStatus.up(name, type, elapsed(start), upDetail);
      }
      return ComponentStatus.down(name, type, elapsed(start), "HTTP " + response.statusCode());
    } catch (IOException e) {
      return ComponentStatus.down(name, type, elapsed(start), e.getClass().getSimpleName());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return ComponentStatus.down(name, type, elapsed(start), "interrompido");
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
