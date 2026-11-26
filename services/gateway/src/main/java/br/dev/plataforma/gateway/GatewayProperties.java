package br.dev.plataforma.gateway;

import br.dev.plataforma.contracts.tenants.Plano;
import java.net.URI;
import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuração do gateway ({@code plataforma.gateway.*}).
 *
 * @param issuer emissor esperado no token (o endereço público do Keycloak)
 * @param jwkSetUri onde buscar as chaves públicas (o endereço interno do Keycloak)
 * @param audience audiência exigida no token
 * @param services endereço de cada serviço roteado
 * @param limits limite de requisições por plano
 * @param userLimit limite por usuário nas chamadas sem tenant (administração e {@code /me})
 * @param tenants carga do catálogo de tenants (eventos e listagem inicial)
 */
@ConfigurationProperties("plataforma.gateway")
public record GatewayProperties(
    String issuer,
    String jwkSetUri,
    String audience,
    Services services,
    Map<Plano, Limit> limits,
    Limit userLimit,
    Tenants tenants) {

  public GatewayProperties {
    audience = audience == null ? "plataforma-gateway" : audience;
    services = services == null ? new Services(null, null) : services;
    Map<Plano, Limit> merged = new EnumMap<>(Plano.class);
    merged.put(Plano.GRATUITO, new Limit(5, 10));
    merged.put(Plano.PROFISSIONAL, new Limit(20, 40));
    merged.put(Plano.EMPRESARIAL, new Limit(50, 100));
    if (limits != null) {
      merged.putAll(limits);
    }
    limits = Map.copyOf(merged);
    tenants = tenants == null ? new Tenants(null, null) : tenants;
    userLimit = userLimit == null ? new Limit(20, 40) : userLimit;
  }

  /** Endereços dos serviços de destino. */
  public record Services(URI tenants, URI status) {
    public Services {
      tenants = tenants == null ? URI.create("http://localhost:8081") : tenants;
      status = status == null ? URI.create("http://localhost:8090") : status;
    }
  }

  /**
   * Token bucket por tenant.
   *
   * @param perSecond reposição de fichas por segundo
   * @param burst capacidade do balde (rajada máxima)
   */
  public record Limit(int perSecond, int burst) {
    public Limit {
      if (perSecond < 1 || burst < 1) {
        throw new IllegalArgumentException(
            "Limite inválido (per-second="
                + perSecond
                + ", burst="
                + burst
                + "): os dois devem ser ≥ 1");
      }
    }
  }

  /**
   * @param events liga a leitura de tenant.criado e tenant.alterado no Pulsar
   * @param bootstrapRetry intervalo entre tentativas de carregar a lista inicial do tenant-service
   */
  public record Tenants(Boolean events, Duration bootstrapRetry) {
    public Tenants {
      events = events == null ? Boolean.TRUE : events;
      bootstrapRetry = bootstrapRetry == null ? Duration.ofSeconds(5) : bootstrapRetry;
    }
  }
}
