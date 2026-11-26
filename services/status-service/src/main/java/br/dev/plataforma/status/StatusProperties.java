package br.dev.plataforma.status;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Configuração do status-service ({@code plataforma.status.*}).
 *
 * @param timeout tempo máximo de cada verificação
 * @param mongo instâncias MongoDB, uma por microsserviço
 * @param pulsar endereço do admin HTTP do Pulsar
 * @param services microsserviços da plataforma, verificados pela readiness do Actuator
 */
@Validated
@ConfigurationProperties("plataforma.status")
public record StatusProperties(
    @NotNull Duration timeout,
    @Valid List<MongoTarget> mongo,
    @Valid PulsarTarget pulsar,
    @Valid List<ServiceTarget> services) {

  public StatusProperties {
    mongo = mongo == null ? List.of() : List.copyOf(mongo);
    services = services == null ? List.of() : List.copyOf(services);
  }

  /** Uma instância MongoDB a verificar. */
  public record MongoTarget(@NotBlank String name, @NotBlank String uri) {}

  /** O Pulsar a verificar, pelo admin HTTP. */
  public record PulsarTarget(@NotBlank String name, @NotNull URI adminUrl) {}

  /**
   * Um serviço a verificar, pela URL base (ex.: http://tenant-service:8081).
   *
   * @param healthPath caminho que responde 200 quando o serviço está pronto (padrão: a readiness do
   *     Actuator; o Keycloak usa {@code health/ready})
   * @param metricsPath métricas no formato do Prometheus (padrão: {@code actuator/prometheus}); com
   *     {@code none}, o serviço não tem métricas na página de saúde (o Keycloak)
   */
  public record ServiceTarget(
      @NotBlank String name, @NotNull URI url, String healthPath, String metricsPath) {
    public ServiceTarget {
      healthPath =
          healthPath == null || healthPath.isBlank() ? ServiceCheck.HEALTH_PATH : healthPath;
      metricsPath =
          metricsPath == null || metricsPath.isBlank()
              ? ServiceCheck.METRICS_PATH
              : "none".equals(metricsPath) ? null : metricsPath;
    }
  }
}
