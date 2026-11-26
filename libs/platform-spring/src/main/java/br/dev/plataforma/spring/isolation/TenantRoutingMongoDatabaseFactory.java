package br.dev.plataforma.spring.isolation;

import br.dev.plataforma.core.TenantId;
import br.dev.plataforma.spring.tenancy.TenantContext;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoDatabase;
import java.util.Optional;
import org.springframework.data.mongodb.core.SimpleMongoClientDatabaseFactory;

/**
 * Escolhe a database pelo tenant do contexto (ADR-0014): POOL fica na padrão, BRIDGE e SILO na
 * dedicada. Sem tenant no contexto (jobs, relay, índices) ou dentro de {@link PlatformDatabase},
 * usa a padrão.
 *
 * <p>A fábrica presa a uma sessão (transações) delega para {@link #getMongoDatabase()} a cada
 * operação, então uma transação pode gravar o pedido na database do tenant e o outbox na padrão: o
 * MongoDB aceita transações entre databases do mesmo replica set.
 */
public class TenantRoutingMongoDatabaseFactory extends SimpleMongoClientDatabaseFactory {

  private final TenantPlacements placements;

  public TenantRoutingMongoDatabaseFactory(
      MongoClient client, String defaultDatabase, TenantPlacements placements) {
    super(client, defaultDatabase);
    this.placements = placements;
  }

  @Override
  public MongoDatabase getMongoDatabase() {
    Optional<TenantId> tenant = TenantContext.current();
    if (PlatformDatabase.active() || tenant.isEmpty()) {
      return super.getMongoDatabase();
    }
    String database = placements.databaseFor(tenant.get());
    return database.equals(getDefaultDatabaseName())
        ? super.getMongoDatabase()
        : getMongoDatabase(database);
  }
}
