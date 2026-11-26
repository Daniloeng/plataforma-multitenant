package br.dev.plataforma.spring;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuração da biblioteca comum ({@code plataforma.*}).
 *
 * @param tenancy regras do cabeçalho de tenant
 * @param outbox publicação de eventos
 * @param idempotency retenção dos registros de deduplicação e do outbox publicado
 */
@ConfigurationProperties("plataforma")
public record PlatformProperties(Tenancy tenancy, OutboxProps outbox, Idempotency idempotency) {

  public PlatformProperties {
    tenancy = tenancy == null ? new Tenancy(null, null) : tenancy;
    outbox = outbox == null ? new OutboxProps(null, null, null, 0) : outbox;
    idempotency = idempotency == null ? new Idempotency(null) : idempotency;
  }

  /**
   * @param requiredPaths caminhos que exigem X-Tenant-Id (padrão: /api/v1/**)
   * @param excludedPaths exceções (ex.: a API administrativa de tenants)
   */
  public record Tenancy(List<String> requiredPaths, List<String> excludedPaths) {
    public Tenancy {
      requiredPaths = requiredPaths == null ? List.of("/api/v1/**") : List.copyOf(requiredPaths);
      excludedPaths = excludedPaths == null ? List.of() : List.copyOf(excludedPaths);
    }
  }

  /**
   * @param enabled liga o relay que publica o outbox (padrão: true)
   * @param interval intervalo entre ciclos do relay (padrão: 200 ms)
   * @param sendTimeout tempo máximo de uma publicação (padrão: 5 s)
   * @param batchSize mensagens por ciclo (padrão: 100)
   */
  public record OutboxProps(
      Boolean enabled, Duration interval, Duration sendTimeout, int batchSize) {
    public OutboxProps {
      enabled = enabled == null ? Boolean.TRUE : enabled;
      interval = interval == null ? Duration.ofMillis(200) : interval;
      sendTimeout = sendTimeout == null ? Duration.ofSeconds(5) : sendTimeout;
      batchSize = batchSize <= 0 ? 100 : batchSize;
    }
  }

  /**
   * @param retention por quanto tempo guardar eventos processados e publicados (padrão: 7 dias)
   */
  public record Idempotency(Duration retention) {
    public Idempotency {
      retention = retention == null ? Duration.ofDays(7) : retention;
    }
  }
}
