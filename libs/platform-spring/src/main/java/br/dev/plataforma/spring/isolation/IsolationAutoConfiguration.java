package br.dev.plataforma.spring.isolation;

import br.dev.plataforma.spring.PlatformProperties;
import br.dev.plataforma.spring.events.EventSubscriber;
import com.mongodb.client.MongoClient;
import java.time.Clock;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.data.mongo.MongoDataAutoConfiguration;
import org.springframework.boot.autoconfigure.mongo.MongoAutoConfiguration;
import org.springframework.boot.autoconfigure.mongo.MongoConnectionDetails;
import org.springframework.boot.autoconfigure.mongo.MongoProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.data.mongodb.MongoDatabaseFactory;

/**
 * Database por tenant nos níveis BRIDGE e SILO (ADR-0014). Ligue com {@code
 * plataforma.isolation.enabled=true} e liste as coleções de negócio em {@code
 * plataforma.isolation.collections}. Roda antes do Spring Data, para a fábrica de database com
 * roteamento ocupar o lugar da padrão (o MongoTemplate e o gerenciador de transações a usam).
 */
@AutoConfiguration(after = MongoAutoConfiguration.class, before = MongoDataAutoConfiguration.class)
@ConditionalOnClass({MongoClient.class, MongoDatabaseFactory.class})
@ConditionalOnProperty(prefix = "plataforma.isolation", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(PlatformProperties.class)
public class IsolationAutoConfiguration {

  @Bean
  TenantPlacements tenantPlacements(
      MongoClient client,
      MongoProperties mongoProperties,
      MongoConnectionDetails connection,
      ObjectProvider<Clock> clock,
      PlatformProperties props) {
    String database =
        mongoProperties.getDatabase() != null
            ? mongoProperties.getDatabase()
            : connection.getConnectionString().getDatabase();
    var cfg = props.isolation();
    var placements =
        new TenantPlacements(
            client.getDatabase(database),
            clock.getIfAvailable(Clock::systemUTC),
            cfg.grace().minus(cfg.refresh()),
            cfg.lease());
    try {
      placements.refresh(); // antes do servidor web aceitar requisições
    } catch (RuntimeException e) {
      // Sem o mapa, o roteamento recusa as operações dos tenants (503) até a primeira releitura.
      org.slf4j.LoggerFactory.getLogger(IsolationAutoConfiguration.class)
          .warn("Mapa de isolamento não carregou na subida: {}", e.toString());
    }
    return placements;
  }

  @Bean
  MongoDatabaseFactory tenantRoutingMongoDatabaseFactory(
      MongoClient client, TenantPlacements placements) {
    return new TenantRoutingMongoDatabaseFactory(client, placements.defaultDatabase(), placements);
  }

  @Bean
  TenantMigrator tenantMigrator(
      MongoClient client, TenantPlacements placements, PlatformProperties props) {
    return new TenantMigrator(
        client, placements, props.isolation().collections(), props.isolation().grace());
  }

  @Bean
  TenantIsolation tenantIsolation(
      MongoClient client,
      TenantPlacements placements,
      TenantMigrator migrator,
      PlatformProperties props) {
    var cfg = props.isolation();
    return new TenantIsolation(client, placements, migrator, cfg.refresh(), cfg.awaitTimeout());
  }

  /** Consumidores de tenant.* da migração, se o serviço consome eventos. */
  @Bean
  SmartInitializingSingleton tenantIsolationEvents(
      TenantIsolation isolation, ObjectProvider<EventSubscriber> subscriber) {
    return () -> subscriber.ifAvailable(isolation::register);
  }
}
