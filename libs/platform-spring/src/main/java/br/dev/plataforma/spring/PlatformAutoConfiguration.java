package br.dev.plataforma.spring;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.spring.idempotency.IdempotencyIndexes;
import br.dev.plataforma.spring.idempotency.IdempotentConsumer;
import br.dev.plataforma.spring.outbox.EventPublisher;
import br.dev.plataforma.spring.outbox.Outbox;
import br.dev.plataforma.spring.outbox.OutboxRelay;
import br.dev.plataforma.spring.outbox.PulsarEventPublisher;
import br.dev.plataforma.spring.tenancy.TenantContextFilter;
import br.dev.plataforma.spring.tenancy.TenantGuard;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import org.apache.pulsar.client.api.PulsarClient;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.data.mongo.MongoDataAutoConfiguration;
import org.springframework.boot.autoconfigure.pulsar.PulsarAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.data.mongodb.MongoDatabaseFactory;
import org.springframework.data.mongodb.MongoTransactionManager;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.SimpleAsyncTaskScheduler;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Liga a biblioteca comum em qualquer serviço que a tenha no classpath: filtro de tenant, guarda de
 * gravação, transações MongoDB, outbox com relay para o Pulsar e consumo idempotente.
 */
@AutoConfiguration(after = {MongoDataAutoConfiguration.class, PulsarAutoConfiguration.class})
@EnableConfigurationProperties(PlatformProperties.class)
public class PlatformAutoConfiguration {

  @Bean
  @ConditionalOnMissingBean
  Clock platformClock() {
    return Clock.systemUTC();
  }

  @Bean
  @ConditionalOnMissingBean
  EventCatalog eventCatalog() {
    return EventCatalog.defaultCatalog();
  }

  /** Filtro de tenant, logo no começo da cadeia. */
  @Configuration(proxyBeanMethods = false)
  @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
  static class Web {
    @Bean
    FilterRegistrationBean<TenantContextFilter> tenantContextFilter(
        PlatformProperties props, ObjectMapper json) {
      var filter =
          new TenantContextFilter(
              props.tenancy().requiredPaths(), props.tenancy().excludedPaths(), json);
      var registration = new FilterRegistrationBean<>(filter);
      registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
      return registration;
    }
  }

  /** MongoDB: transações, guarda de tenant, outbox e deduplicação. */
  @Configuration(proxyBeanMethods = false)
  @ConditionalOnClass(MongoOperations.class)
  static class Mongo {

    @Bean
    @ConditionalOnMissingBean(PlatformTransactionManager.class)
    MongoTransactionManager transactionManager(MongoDatabaseFactory factory) {
      return new MongoTransactionManager(factory);
    }

    @Bean
    TenantGuard tenantGuard() {
      return new TenantGuard();
    }

    @Bean
    Outbox outbox(MongoOperations mongo, EventCatalog catalog, PlatformProperties props) {
      return new Outbox(mongo, catalog, props.service());
    }

    @Bean
    IdempotentConsumer idempotentConsumer(MongoOperations mongo, Clock clock) {
      return new IdempotentConsumer(mongo, clock);
    }

    /**
     * Cria os índices quando os singletons ficam prontos, antes de o servidor web aceitar
     * requisições: o índice único da deduplicação precisa existir antes do primeiro evento.
     */
    @Bean
    SmartInitializingSingleton platformIndexes(MongoOperations mongo, PlatformProperties props) {
      return () -> IdempotencyIndexes.ensure(mongo, props.idempotency().retention());
    }
  }

  /** Relay do outbox para o Pulsar. Desligue com plataforma.outbox.enabled=false. */
  @Configuration(proxyBeanMethods = false)
  @ConditionalOnClass({MongoOperations.class, PulsarClient.class})
  @ConditionalOnProperty(
      prefix = "plataforma.outbox",
      name = "enabled",
      havingValue = "true",
      matchIfMissing = true)
  static class Relay {

    @Bean
    @ConditionalOnMissingBean
    EventPublisher eventPublisher(
        PulsarClient client, EventCatalog catalog, PlatformProperties props) {
      return new PulsarEventPublisher(client, catalog, props.outbox().sendTimeout());
    }

    @Bean
    OutboxRelay outboxRelay(
        MongoOperations mongo, EventPublisher publisher, Clock clock, PlatformProperties props) {
      return new OutboxRelay(mongo, publisher, clock, props.outbox().batchSize());
    }

    /** Um scheduler próprio, de uma thread, para o relay nunca rodar em paralelo consigo mesmo. */
    @Bean(destroyMethod = "close")
    SimpleAsyncTaskScheduler outboxScheduler(OutboxRelay relay, PlatformProperties props) {
      SimpleAsyncTaskScheduler scheduler = new SimpleAsyncTaskScheduler();
      scheduler.setThreadNamePrefix("outbox-relay-");
      scheduler.setVirtualThreads(true);
      ((TaskScheduler) scheduler)
          .scheduleWithFixedDelay(relay::runCycle, props.outbox().interval());
      return scheduler;
    }
  }
}
