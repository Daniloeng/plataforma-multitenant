package br.dev.plataforma.status;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Verifica um microsserviço da plataforma pela readiness do Actuator ({@code
 * /actuator/health/readiness}): 200 significa que ele subiu e as dependências dele responderam.
 * Pronto, o serviço também tem as métricas lidas do {@code /actuator/prometheus} (ADR-0015); sem
 * elas, a verificação continua UP, só sem métricas.
 */
public class ServiceCheck extends HttpHealthCheck {

  private static final Logger LOG = LoggerFactory.getLogger(ServiceCheck.class);

  static final String HEALTH_PATH = "actuator/health/readiness";
  static final String METRICS_PATH = "actuator/prometheus";

  private final URI metricsUri;

  public ServiceCheck(String name, URI baseUrl, Duration timeout) {
    this(name, baseUrl, HEALTH_PATH, METRICS_PATH, timeout, newClient(timeout));
  }

  /**
   * @param metricsPath caminho das métricas no formato do Prometheus; vazio ou nulo, sem métricas
   */
  public ServiceCheck(
      String name, URI baseUrl, String healthPath, String metricsPath, Duration timeout) {
    this(name, baseUrl, healthPath, metricsPath, timeout, newClient(timeout));
  }

  ServiceCheck(String name, URI baseUrl, Duration timeout, HttpClient http) {
    this(name, baseUrl, HEALTH_PATH, METRICS_PATH, timeout, http);
  }

  ServiceCheck(
      String name,
      URI baseUrl,
      String healthPath,
      String metricsPath,
      Duration timeout,
      HttpClient http) {
    super(name, ComponentType.SERVICE, baseUrl, healthPath, "readiness UP", timeout, http);
    String base = baseUrl.toString().endsWith("/") ? baseUrl.toString() : baseUrl + "/";
    this.metricsUri =
        metricsPath == null || metricsPath.isBlank() ? null : URI.create(base).resolve(metricsPath);
  }

  URI metricsUri() {
    return metricsUri;
  }

  @Override
  public ComponentStatus check() {
    ComponentStatus status = super.check();
    if (status.status() != HealthState.UP || metricsUri == null) {
      return status;
    }
    return status.withMetrics(metrics());
  }

  /** Métricas do serviço, ou null se não respondeu (a saúde já foi decidida pela readiness). */
  ServiceMetrics metrics() {
    HttpRequest request = HttpRequest.newBuilder(metricsUri).timeout(timeout()).GET().build();
    try {
      HttpResponse<String> response = http().send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() != 200) {
        return null;
      }
      return PrometheusText.parse(response.body()).toServiceMetrics();
    } catch (IOException | RuntimeException e) {
      LOG.debug("Métricas de {} indisponíveis: {}", name(), e.toString());
      return null;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return null;
    }
  }
}
