package br.dev.plataforma.spring.isolation;

import br.dev.plataforma.contracts.tenants.TenantAlterado;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import br.dev.plataforma.core.IsolationLevel;
import br.dev.plataforma.core.TenantId;
import br.dev.plataforma.spring.events.EventSubscriber;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;

/**
 * Liga as peças do isolamento por database (ADR-0014): consome tenant.criado e tenant.alterado,
 * agenda a migração quando o nível sobe, relê o mapa de tempos em tempos (para saber das migrações
 * que outra réplica começou) e assume migrações paradas depois do lease.
 */
public class TenantIsolation implements SmartLifecycle {

  private static final Logger LOG = LoggerFactory.getLogger(TenantIsolation.class);

  static final int ALERTA_TENTATIVAS = 3;

  private final com.mongodb.client.MongoClient client;
  private final TenantPlacements placements;
  private final TenantMigrator migrator;
  private final Duration refresh;
  private final Duration lease;
  private final Duration awaitTimeout;
  private ScheduledExecutorService scheduler;
  private volatile boolean running;

  public TenantIsolation(
      com.mongodb.client.MongoClient client,
      TenantPlacements placements,
      TenantMigrator migrator,
      Duration refresh,
      Duration lease,
      Duration awaitTimeout) {
    this.client = client;
    this.placements = placements;
    this.migrator = migrator;
    this.refresh = refresh;
    this.lease = lease;
    this.awaitTimeout = awaitTimeout;
  }

  /** Registra os consumidores de tenant.* e a espera dos demais consumidores pela migração. */
  public void register(EventSubscriber subscriber) {
    subscriber.onPlatform(
        TenantCriado.class,
        "isolamento-tenant-criado",
        e -> observe(e.getTenantId(), e.getNivelIsolamento().name(), e.getVersao()));
    subscriber.onPlatform(
        TenantAlterado.class,
        "isolamento-tenant-alterado",
        e -> observe(e.getTenantId(), e.getNivelIsolamento().name(), e.getVersao()));
    subscriber.setTenantAwaiter(
        tenant -> {
          if (!placements.awaitReady(tenant, awaitTimeout)) {
            throw new TenantMigratingException(tenant);
          }
        });
  }

  public void observe(String tenantId, String level, long version) {
    TenantId tenant = TenantId.of(tenantId);
    placements
        .observe(tenant, IsolationLevel.parse(level), version)
        .ifPresent(p -> migrator.schedule(tenant));
  }

  /** Uma rodada: relê o mapa e assume migrações paradas (dona caiu, desistiu ou falhou). */
  void tick() {
    placements.refresh();
    for (TenantPlacement p : placements.migrating()) {
      TenantId tenant = TenantId.of(p.tenantId());
      if (p.attempts() >= ALERTA_TENTATIVAS) {
        LOG.error(
            "Migração do tenant {} já falhou {} vezes; o tenant segue com 503 até alguém olhar",
            tenant,
            p.attempts());
      }
      if (!migrator.isRunning(tenant) && placements.claimStale(p, lease)) {
        LOG.warn("Migração do tenant {} estava parada; esta réplica assume", tenant);
        migrator.schedule(tenant);
      }
    }
  }

  /**
   * Nunca deixa a exceção escapar: ela cancelaria o agendamento, e o mapa congelado faria o
   * roteamento recusar tudo (falha fechada) para sempre.
   */
  private void safeTick() {
    try {
      tick();
    } catch (Throwable e) { // Error também
      LOG.warn("Releitura do mapa de isolamento falhou; tenta de novo", e);
    }
  }

  @Override
  public void start() {
    safeTick();
    // Índices e coleções novos chegam também às databases já migradas.
    for (TenantPlacement p : placements.dedicated()) {
      if (!p.migrating()) {
        try {
          migrator.syncCollections(client.getDatabase(p.database()));
        } catch (RuntimeException e) {
          LOG.warn("Índices da database {} não foram conferidos: {}", p.database(), e.toString());
        }
      }
    }
    scheduler =
        Executors.newSingleThreadScheduledExecutor(
            Thread.ofVirtual().name("isolamento-releitura").factory());
    scheduler.scheduleWithFixedDelay(
        this::safeTick, refresh.toMillis(), refresh.toMillis(), TimeUnit.MILLISECONDS);
    running = true;
  }

  @Override
  public void stop() {
    running = false;
    if (scheduler != null) {
      scheduler.shutdownNow();
    }
    migrator.close();
  }

  @Override
  public boolean isRunning() {
    return running;
  }

  /**
   * Sobe antes do EventSubscriber (fase padrão). O mapa já é lido na criação do bean, antes do
   * servidor web; sem ele, o roteamento recusa as operações (falha fechada).
   */
  @Override
  public int getPhase() {
    return DEFAULT_PHASE - 1000;
  }
}
