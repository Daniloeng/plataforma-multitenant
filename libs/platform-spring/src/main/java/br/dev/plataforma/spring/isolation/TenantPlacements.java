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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
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
 * gravações usam o driver direto, sem sessão, fora da transação do evento que as causou. Uma
 * releitura que começou antes de uma gravação local não a desfaz no cache.
 *
 * <p>Falha fechada: se a réplica não consegue reler o mapa por mais que {@code staleAfter}, ela
 * pode não ter visto uma migração começar, então recusa as operações dos tenants (503) até reler.
 */
public class TenantPlacements {

  private static final Logger LOG = LoggerFactory.getLogger(TenantPlacements.class);

  public static final String COLLECTION = "tenant_niveis";
  private static final int MAX_CAS = 5;
  private static final Duration MAX_BACKOFF = Duration.ofMinutes(5);

  private record Entry(TenantPlacement placement, long writtenAt) {}

  private final MongoCollection<Document> collection;
  private final String defaultDatabase;
  private final Clock clock;
  private final Duration staleAfter;
  private final Duration lease;
  private final String replica = UUID.randomUUID().toString();
  private final Map<String, Entry> cache = new ConcurrentHashMap<>();

  /** Relógio lógico local: ordena releituras e gravações desta réplica. */
  private final AtomicLong tick = new AtomicLong();

  private volatile Instant lastRefresh;

  /**
   * @param defaultDatabase database padrão do serviço (POOL); a dedicada é {@code
   *     <padrão>_t_<tenant>}
   * @param staleAfter idade máxima do mapa antes de o roteamento recusar operações
   * @param lease sem batimento por esse tempo, outra réplica assume a migração
   */
  public TenantPlacements(
      MongoDatabase defaultDatabase, Clock clock, Duration staleAfter, Duration lease) {
    this.collection = defaultDatabase.getCollection(COLLECTION);
    this.defaultDatabase = defaultDatabase.getName();
    this.clock = clock;
    this.staleAfter = staleAfter;
    this.lease = lease;
  }

  public String defaultDatabase() {
    return defaultDatabase;
  }

  /** Identificador desta réplica como dona de migrações. */
  public String replica() {
    return replica;
  }

  public Duration lease() {
    return lease;
  }

  /** Database dedicada de um tenant (BRIDGE e SILO). */
  public String dedicatedDatabase(TenantId tenant) {
    return defaultDatabase + "_t_" + tenant.value();
  }

  /**
   * Relê o mapa inteiro (poucos documentos: um por tenant). Entradas gravadas por esta réplica
   * depois do começo da leitura ficam como estão: são mais novas que o retrato lido.
   */
  public void refresh() {
    long startedAt = tick.incrementAndGet();
    Map<String, TenantPlacement> snapshot = new HashMap<>();
    for (Document d : collection.find()) {
      TenantPlacement p = fromDocument(d);
      snapshot.put(p.tenantId().value(), p);
    }
    snapshot.forEach(
        (id, p) ->
            cache.compute(
                id,
                (k, current) ->
                    current != null && current.writtenAt() > startedAt
                        ? current
                        : new Entry(p, startedAt)));
    cache
        .entrySet()
        .removeIf(e -> !snapshot.containsKey(e.getKey()) && e.getValue().writtenAt() <= startedAt);
    lastRefresh = clock.instant();
  }

  /** Se o mapa foi relido há pouco (o roteamento só confia nele assim). */
  public boolean fresh() {
    Instant last = lastRefresh;
    return last != null && !last.plus(staleAfter).isBefore(clock.instant());
  }

  /** Posição do tenant; quem nunca apareceu está no POOL, na database padrão. */
  public TenantPlacement of(TenantId tenant) {
    Entry e = cache.get(tenant.value());
    return e != null ? e.placement() : pool(tenant);
  }

  private TenantPlacement pool(TenantId tenant) {
    return new TenantPlacement(
        tenant,
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
    return cache.values().stream()
        .map(Entry::placement)
        .filter(p -> !p.database().equals(defaultDatabase))
        .toList();
  }

  /** Migrações em andamento. */
  public List<TenantPlacement> migrating() {
    return cache.values().stream()
        .map(Entry::placement)
        .filter(TenantPlacement::migrating)
        .toList();
  }

  /**
   * Registra o nível visto num tenant.criado ou tenant.alterado. Versão menor ou igual à conhecida
   * é ignorada (os dois tópicos não têm ordem entre si). A gravação é um compare-and-set: se outra
   * réplica gravou no meio, relê e decide de novo.
   *
   * @return a posição nova, quando os dados precisam migrar (esta réplica fica dona da migração)
   */
  public Optional<TenantPlacement> observe(TenantId tenant, IsolationLevel level, long version) {
    for (int attempt = 0; attempt < MAX_CAS; attempt++) {
      Document stored = collection.find(Filters.eq("_id", tenant.value())).first();
      TenantPlacement current = stored == null ? pool(tenant) : fromDocument(stored);
      if (version <= current.version()) {
        if (stored != null) {
          put(current);
        }
        return Optional.empty();
      }
      boolean moves = level.hasDedicatedNamespace() && current.database().equals(defaultDatabase);
      TenantPlacement next;
      if (moves) {
        next =
            new TenantPlacement(
                tenant,
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
                tenant,
                level,
                current.database(),
                current.status(),
                current.migratedAt(),
                current.migrationStartedAt(),
                current.owner(),
                current.attempts(),
                version);
      }
      Bson expected =
          stored == null
              ? null
              : Filters.and(
                  Filters.eq("_id", tenant.value()), Filters.eq("version", current.version()));
      if (compareAndSet(expected, next)) {
        return moves ? Optional.of(next) : Optional.empty();
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
  public boolean claimStale(TenantPlacement p) {
    if (!p.migrating()
        || p.migrationStartedAt() == null
        || p.migrationStartedAt().plus(lease).isAfter(clock.instant())) {
      return false;
    }
    var result =
        collection.updateOne(
            Filters.and(
                Filters.eq("_id", p.tenantId().value()),
                Filters.eq("status", TenantPlacement.Status.MIGRATING.name()),
                Filters.eq("migrationStartedAt", Date.from(p.migrationStartedAt()))),
            Updates.combine(
                Updates.set("migrationStartedAt", Date.from(clock.instant())),
                Updates.set("owner", replica)));
    reload(p.tenantId());
    return result.getModifiedCount() == 1;
  }

  /**
   * Solta o lease. No desligamento, outra réplica assume já. Depois de uma falha, a próxima
   * tentativa espera um tempo que dobra a cada falha (10 s, 20 s, 40 s... até 5 min), para um erro
   * que se repete não virar um laço.
   *
   * @param failed se a tentativa falhou (conta em {@code attempts}, para o alerta)
   */
  public void release(TenantId tenant, boolean failed) {
    Instant leaseStart = Instant.EPOCH;
    if (failed) {
      int attempts = of(tenant).attempts();
      leaseStart = clock.instant().minus(lease).plus(backoff(attempts + 1));
    }
    collection.updateOne(
        ownedMigration(tenant),
        Updates.combine(
            Updates.set("migrationStartedAt", Date.from(leaseStart)),
            Updates.inc("attempts", failed ? 1 : 0)));
    reload(tenant);
  }

  /** Espera antes da próxima tentativa, depois de {@code attempts} falhas. */
  static Duration backoff(int attempts) {
    Duration d = Duration.ofSeconds(5).multipliedBy(1L << Math.min(Math.max(attempts, 1), 10));
    return d.compareTo(MAX_BACKOFF) > 0 ? MAX_BACKOFF : d;
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
   * prazo acabou ou a thread foi interrompida.
   */
  public boolean awaitReady(TenantId tenant, Duration timeout) {
    Instant deadline = clock.instant().plus(timeout);
    while (!fresh() || of(tenant).migrating()) {
      if (!clock.instant().isBefore(deadline)) {
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
      put(fromDocument(d));
    }
  }

  private void put(TenantPlacement p) {
    cache.put(p.tenantId().value(), new Entry(p, tick.incrementAndGet()));
  }

  private Bson ownedMigration(TenantId tenant) {
    return Filters.and(
        Filters.eq("_id", tenant.value()),
        Filters.eq("status", TenantPlacement.Status.MIGRATING.name()),
        Filters.eq("owner", replica));
  }

  /** Grava {@code p} se o documento ainda é o lido ({@code expected}; null = não existia). */
  private boolean compareAndSet(Bson expected, TenantPlacement p) {
    Document d = toDocument(p);
    try {
      if (expected == null) {
        collection.insertOne(d);
      } else if (collection.replaceOne(expected, d, new ReplaceOptions()).getMatchedCount() == 0) {
        return false;
      }
    } catch (MongoWriteException e) {
      if (e.getError().getCategory() == ErrorCategory.DUPLICATE_KEY) {
        return false; // outra réplica criou o documento no meio
      }
      throw e;
    }
    put(p);
    return true;
  }

  private static Document toDocument(TenantPlacement p) {
    return new Document("_id", p.tenantId().value())
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
        TenantId.of(d.getString("_id")),
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
