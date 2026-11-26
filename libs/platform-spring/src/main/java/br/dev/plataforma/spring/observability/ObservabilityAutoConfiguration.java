package br.dev.plataforma.spring.observability;

import br.dev.plataforma.spring.PlatformAutoConfiguration;
import br.dev.plataforma.spring.isolation.IsolationAutoConfiguration;
import br.dev.plataforma.spring.isolation.TenantMigrator;
import br.dev.plataforma.spring.isolation.TenantPlacements;
import br.dev.plataforma.spring.outbox.CurrentTrace;
import br.dev.plataforma.spring.outbox.Outbox;
import br.dev.plataforma.spring.outbox.OutboxRelay;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationPredicate;
import io.micrometer.tracing.Span;
import io.micrometer.tracing.Tracer;
import io.micrometer.tracing.propagation.Propagator;
import java.time.Clock;
import java.util.HashMap;
import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import org.springframework.http.server.observation.ServerRequestObservationConvention;

/**
 * Métricas e tracing da plataforma (ADR-0015), quando o serviço tem o actuator: métricas do outbox,
 * do relay e do isolamento, tag de tenant nas requisições HTTP e o {@code traceparent} do span
 * atual gravado no outbox.
 */
@AutoConfiguration(after = {PlatformAutoConfiguration.class, IsolationAutoConfiguration.class})
@ConditionalOnClass(MeterRegistry.class)
public class ObservabilityAutoConfiguration {

  /** Métricas do outbox, do relay e do isolamento (serviços com MongoDB; o gateway não tem). */
  @Configuration(proxyBeanMethods = false)
  @ConditionalOnClass(MongoOperations.class)
  static class Metrics {
    @Bean
    PlatformMetrics platformMetrics(
        ObjectProvider<Outbox> outbox,
        ObjectProvider<MongoOperations> mongo,
        ObjectProvider<OutboxRelay> relay,
        ObjectProvider<TenantPlacements> placements,
        ObjectProvider<TenantMigrator> migrator,
        ObjectProvider<Clock> clock) {
      return new PlatformMetrics(
          outbox.getIfAvailable() == null ? null : mongo.getIfAvailable(),
          relay.getIfAvailable(),
          placements.getIfAvailable(),
          migrator.getIfAvailable(),
          clock.getIfAvailable(Clock::systemUTC));
    }
  }

  /** Tag de tenant em {@code http_server_requests_seconds} (só Spring MVC; o gateway é reativo). */
  @Configuration(proxyBeanMethods = false)
  @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
  @ConditionalOnClass(ServerRequestObservationConvention.class)
  static class Http {
    @Bean
    @ConditionalOnMissingBean(ServerRequestObservationConvention.class)
    TenantObservationConvention tenantObservationConvention() {
      return new TenantObservationConvention();
    }
  }

  /** {@code traceparent} do span atual, para o outbox levar o trace até o consumidor. */
  @Configuration(proxyBeanMethods = false)
  @ConditionalOnClass(Tracer.class)
  static class Tracing {
    @Bean
    @ConditionalOnMissingBean
    CurrentTrace currentTrace(
        ObjectProvider<Tracer> tracer, ObjectProvider<Propagator> propagator) {
      return () -> traceparent(tracer.getIfAvailable(), propagator.getIfAvailable());
    }
  }

  /**
   * O {@code traceparent} que o propagador do tracing escreveria num cabeçalho, para o span atual.
   */
  static String traceparent(Tracer tracer, Propagator propagator) {
    Span span = tracer == null ? null : tracer.currentSpan();
    if (span == null || propagator == null) {
      return null;
    }
    Map<String, String> carrier = new HashMap<>();
    propagator.inject(span.context(), carrier, Map::put);
    return carrier.get("traceparent");
  }

  /**
   * Não mede streams SSE (a linha do tempo fica aberta por minutos): entrariam no histograma de
   * {@code http_server_requests} e o p99 deixaria de dizer algo sobre as requisições.
   */
  @Configuration(proxyBeanMethods = false)
  @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
  @ConditionalOnClass(ServerRequestObservationContext.class)
  static class Streams {
    @Bean
    ObservationPredicate ignoreEventStreams() {
      return (name, context) -> !isEventStream(context);
    }
  }

  static boolean isEventStream(Observation.Context context) {
    if (!(context instanceof ServerRequestObservationContext http)) {
      return false;
    }
    String accept = http.getCarrier().getHeader("Accept");
    String uri = http.getCarrier().getRequestURI();
    // O cabeçalho cobre qualquer stream; o caminho cobre quem pede a linha do tempo sem ele (curl).
    return (accept != null && accept.contains("text/event-stream"))
        || (uri != null && uri.endsWith("/linha-do-tempo"));
  }
}
