package br.dev.plataforma.spring.isolation;

import br.dev.plataforma.core.IsolationLevel;
import br.dev.plataforma.core.TenantId;
import com.mongodb.ErrorCategory;
import com.mongodb.MongoWriteException;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.model.Filters;
import com.mongodb.client.model.ReplaceOptions;
import com.mongodb.client.model.Updates;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.bson.Document;
import org.bson.conversions.Bson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Mapa tenant → database deste serviço (ADR-0014). Fica em memória para o roteamento não ir ao
 * banco a cada operação, e é persistido na coleção {@value #COLLECTION} da database padrão, que
 * toda réplica relê periodicamente ({@link #refresh()}): é assim que uma réplica fica sabendo da
 * migração que outra começou.
 *
 * <p>Toda gravação é condicional (compare-and-set pela versão ou pelo dono da migração): duas
 * réplicas processando tenant.criado e tenant.alterado ao mesmo tempo não se sobrescrevem. As
 * gravações usam o driver direto, sem sessão, fora da transação do evento que as causou.
 *
 * <p>Falha fechada: se a réplica não consegue reler o mapa por mais que {@code staleAfter}, ela
 * pode não ter visto uma migração começar, então recusa as operações dos tenants (503) até reler.
 */
public class TenantPlacements {

  private static final Logger LOG = LoggerFactory.getLogger(TenantPlacements.class);

  public static final String COLLECTION = "tenant_niveis";
  private static final int MAX_CAS = 5;

  private final MongoCollection<Document> collection;
  private final String defaultDatabase;
  private final Clock clock;
  private final Duration staleAfter;
  private final String replica = UUID.randomUUID().toString();
  private final Map<String, TenantPlacement> cache = new ConcurrentHashMap<>();
  private volatile Instant lastRefresh;

  /**
   * @param defaultDatabase database padrão do serviço (POOL); a dedicada é {@code
   *     <padrão>_t_<tenant>}
   * @param staleAfter idade máxima do mapa antes de o roteamento recusar operações
   */
  public TenantPlacements(MongoDatabase defaultDatabase, Clock clock, Duration staleAfter) {
    this.collection = defaultDatabase.getCollection(COLLECTION);
    this.defaultDatabase = defaultDatabase.getName();
    this.clock = clock;
    this.staleAfter = staleAfter;
  }

  public String defaultDatabase() {
    return defaultDatabase;
  }

  /** Identificador desta réplica como dona de migrações. */
  public String replica() {
    return replica;
  }

  /** Database dedicada de um tenant (BRIDGE e SILO). */
  public String dedicatedDatabase(TenantId tenant) {
    return defaultDatabase + "_t_" + tenant.value();
  }

  /** Relê o mapa inteiro (poucos documentos: um por tenant). */
  public void refresh() {
    Set<String> vistos = new TreeSet<>();
    for (Document d : collection.find()) {
      TenantPlacement p = fromDocument(d);
      cache.put(p.tenantId(), p);
      vistos.add(p.tenantId());
    }
    cache.keySet().retainAll(vistos);
    lastRefresh = clock.instant();
  }

  /** Se o mapa foi relido há pouco (o roteamento só confia nele assim). */
  public boolean fresh() {
    Instant last = lastRefresh;
    return last != null && !last.plus(staleAfter).isBefore(clock.instant());
  }

  /** Posição do tenant; quem nunca apareceu está no POOL, na database padrão. */
  public TenantPlacement of(TenantId tenant) {
    TenantPlacement p = cache.get(tenant.value());
    return p != null ? p : pool(tenant);
  }

  private TenantPlacement pool(TenantId tenant) {
    return new TenantPlacement(
        tenant.value(),
        IsolationLevel.POOL,
        defaultDatabase,
        TenantPlacement.Status.READY,
        null,
        null,
        null,
        0,
        -1);
  }

  /**
   * Database para as operações de negócio do tenant.
   *
   * @throws TenantMigratingException enquanto os dados do tenant mudam de database, ou se o mapa
   *     desta réplica está velho demais para garantir isso
   */
  public String databaseFor(TenantId tenant) {
    if (!fresh()) {
      throw new TenantMigratingException(tenant);
    }
    TenantPlacement p = of(tenant);
    if (p.migrating()) {
      throw new TenantMigratingException(tenant);
    }
    return p.database();
  }

  /** Tenants com database dedicada (pronta ou migrando). */
  public List<TenantPlacement> dedicated() {
    return cache.values().stream().filter(p -> !p.database().equals(defaultDatabase)).toList();
  }

  /** Migrações em andamento. */
  public List<TenantPlacement> migrating() {
    return cache.values().stream().filter(TenantPlacement::migrating).toList();
  }

  /**
   * Registra o nível visto num tenant.criado ou tenant.alterado. Versão menor ou igual à conhecida
   * é ignorada (os dois tópicos não têm ordem entre si). A gravação é um compare-and-set: se outra
   * réplica gravou no meio, relê e decide de novo.
   *
   * @return a posição nova, quando os dados precisam migrar (esta réplica fica dona da migração)
   */
  public Optional<TenantPlacement> observe(TenantId tenant, IsolationLevel level, long version) {
    for (int tentativa = 0; tentativa < MAX_CAS; tentativa++) {
      Document salvo = collection.find(Filters.eq("_id", tenant.value())).first();
      TenantPlacement current = salvo == null ? pool(tenant) : fromDocument(salvo);
      if (version <= current.version()) {
        if (salvo != null) {
          cache.put(current.tenantId(), current);
        }
        return Optional.empty();
      }
      boolean sobe = level.hasDedicatedNamespace() && current.database().equals(defaultDatabase);
      TenantPlacement next;
      if (sobe) {
        next =
            new TenantPlacement(
                tenant.value(),
                level,
                dedicatedDatabase(tenant),
                TenantPlacement.Status.MIGRATING,
                current.migratedAt(),
                clock.instant(),
                replica,
                0,
                version);
      } else {
        if (!level.hasDedicatedNamespace() && !current.database().equals(defaultDatabase)) {
          // O tenant-service não rebaixa (ADR-0014); se acontecer, os dados ficam onde estão.
          LOG.warn(
              "Tenant {} voltou para {}: os dados seguem em {}", tenant, level, current.database());
        }
        next =
            new TenantPlacement(
                tenant.value(),
                level,
                current.database(),
                current.status(),
                current.migratedAt(),
                current.migrationStartedAt(),
                current.owner(),
                current.attempts(),
                version);
      }
      Bson anterior =
          salvo == null
              ? null
              : Filters.and(
                  Filters.eq("_id", tenant.value()), Filters.eq("version", current.version()));
      if (compareAndSet(anterior, next)) {
        return sobe ? Optional.of(next) : Optional.empty();
      }
    }
    throw new IllegalStateException(
        "Mapa de isolamento do tenant " + tenant + " mudou demais ao mesmo tempo; tenta de novo");
  }

  /**
   * Renova o lease da migração (batimento do job). Devolve false se outra réplica assumiu: o job
   * desta réplica precisa parar sem apagar nem marcar nada.
   */
  public boolean heartbeat(TenantId tenant) {
    var result =
        collection.updateOne(
            ownedMigration(tenant), Updates.set("migrationStartedAt", Date.from(clock.instant())));
    return result.getMatchedCount() == 1;
  }

  /**
   * Assume uma migração parada (a réplica dona caiu ou desistiu): só uma réplica consegue trocar o
   * {@code migrationStartedAt} antigo pelo novo.
   */
  public boolean claimStale(TenantPlacement p, Duration lease) {
    if (!p.migrating()
        || p.migrationStartedAt() == null
        || p.migrationStartedAt().plus(lease).isAfter(clock.instant())) {
      return false;
    }
    var result =
        collection.updateOne(
            Filters.and(
                Filters.eq("_id", p.tenantId()),
                Filters.eq("status", TenantPlacement.Status.MIGRATING.name()),
                Filters.eq("migrationStartedAt", Date.from(p.migrationStartedAt()))),
            Updates.combine(
                Updates.set("migrationStartedAt", Date.from(clock.instant())),
                Updates.set("owner", replica)));
    return result.getModifiedCount() == 1;
  }

  /**
   * Solta o lease (desligamento ou falha): outra réplica, ou esta mesma na próxima rodada, pode
   * assumir já.
   *
   * @param failed se a tentativa falhou (conta em {@code attempts}, para o alerta)
   */
  public void release(TenantId tenant, boolean failed) {
    collection.updateOne(
        ownedMigration(tenant),
        Updates.combine(
            Updates.set("migrationStartedAt", new Date(0)),
            Updates.inc("attempts", failed ? 1 : 0)));
    reload(tenant);
  }

  /**
   * Fim da migração: as operações do tenant passam a ir para a database dedicada. Só a dona marca,
   * e só os campos da migração mudam (nível e versão podem ter avançado noutra réplica).
   */
  public boolean markReady(TenantId tenant) {
    var result =
        collection.updateOne(
            ownedMigration(tenant),
            Updates.combine(
                Updates.set("status", TenantPlacement.Status.READY.name()),
                Updates.set("migratedAt", Date.from(clock.instant())),
                Updates.unset("migrationStartedAt"),
                Updates.unset("owner"),
                Updates.set("attempts", 0)));
    reload(tenant);
    return result.getModifiedCount() == 1;
  }

  /**
   * Espera o tenant sair da migração (consumidores de eventos), relendo o mapa. Devolve false se o
   * prazo acabou.
   */
  public boolean awaitReady(TenantId tenant, Duration timeout) {
    Instant limite = clock.instant().plus(timeout);
    while (!fresh() || of(tenant).migrating()) {
      if (!clock.instant().isBefore(limite)) {
        return false;
      }
      try {
        Thread.sleep(200);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return false;
      }
      reload(tenant);
    }
    return true;
  }

  private void reload(TenantId tenant) {
    Document d = collection.find(Filters.eq("_id", tenant.value())).first();
    if (d != null) {
      cache.put(tenant.value(), fromDocument(d));
    }
  }

  private Bson ownedMigration(TenantId tenant) {
    return Filters.and(
        Filters.eq("_id", tenant.value()),
        Filters.eq("status", TenantPlacement.Status.MIGRATING.name()),
        Filters.eq("owner", replica));
  }

  /** Grava {@code p} se o documento ainda é o lido ({@code anterior}; null = não existia). */
  private boolean compareAndSet(Bson anterior, TenantPlacement p) {
    Document d = toDocument(p);
    try {
      if (anterior == null) {
        collection.insertOne(d);
      } else if (collection.replaceOne(anterior, d, new ReplaceOptions()).getMatchedCount() == 0) {
        return false;
      }
    } catch (MongoWriteException e) {
      if (e.getError().getCategory() == ErrorCategory.DUPLICATE_KEY) {
        return false; // outra réplica criou o documento no meio
      }
      throw e;
    }
    cache.put(p.tenantId(), p);
    return true;
  }

  private static Document toDocument(TenantPlacement p) {
    return new Document("_id", p.tenantId())
        .append("level", p.level().name())
        .append("database", p.database())
        .append("status", p.status().name())
        .append("migratedAt", p.migratedAt() == null ? null : Date.from(p.migratedAt()))
        .append(
            "migrationStartedAt",
            p.migrationStartedAt() == null ? null : Date.from(p.migrationStartedAt()))
        .append("owner", p.owner())
        .append("attempts", p.attempts())
        .append("version", p.version());
  }

  private static TenantPlacement fromDocument(Document d) {
    Date migrated = d.getDate("migratedAt");
    Date started = d.getDate("migrationStartedAt");
    Number version = d.get("version", Number.class);
    Number attempts = d.get("attempts", Number.class);
    return new TenantPlacement(
        d.getString("_id"),
        IsolationLevel.valueOf(d.getString("level")),
        d.getString("database"),
        TenantPlacement.Status.valueOf(d.getString("status")),
        migrated == null ? null : migrated.toInstant(),
        started == null ? null : started.toInstant(),
        d.getString("owner"),
        attempts == null ? 0 : attempts.intValue(),
        version == null ? -1 : version.longValue());
  }
}
