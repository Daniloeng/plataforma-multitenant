package br.dev.plataforma.gateway;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.spring.events.EventDecoder;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import org.apache.pulsar.client.api.PulsarClient;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Beans do gateway que não são web: diretório de tenants, limite por plano e a carga do catálogo.
 */
@Configuration(proxyBeanMethods = false)
public class GatewayConfiguration {

  @Bean
  TenantDirectory tenantDirectory() {
    return new TenantDirectory();
  }

  @Bean
  RateLimiter rateLimiter(GatewayProperties props, Clock clock) {
    return new RateLimiter(props.limits(), clock);
  }

  @Bean
  @ConditionalOnProperty(
      prefix = "plataforma.gateway.tenants",
      name = "events",
      havingValue = "true",
      matchIfMissing = true)
  TenantCatalogLoader tenantCatalogLoader(
      TenantDirectory directory,
      PulsarClient pulsar,
      EventDecoder decoder,
      EventCatalog catalog,
      GatewayProperties props,
      ObjectMapper json) {
    return new TenantCatalogLoader(directory, pulsar, decoder, catalog, props, json);
  }
}
