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

  static final int ALERT_ATTEMPTS = 3;

  private final com.mongodb.client.MongoClient client;
  private final TenantPlacements placements;
  private final TenantMigrator migrator;
  private final Duration refresh;
  private final Duration awaitTimeout;
  private ScheduledExecutorService scheduler;
  private volatile boolean running;

  public TenantIsolation(
      com.mongodb.client.MongoClient client,
      TenantPlacements placements,
      TenantMigrator migrator,
      Duration refresh,
      Duration awaitTimeout) {
    this.client = client;
    this.placements = placements;
    this.migrator = migrator;
    this.refresh = refresh;
    this.awaitTimeout = awaitTimeout;
  }

  /** Registra os consumidores de tenant.* e a espera dos demais consumidores pela migração. */
  public void register(EventSubscriber subscriber) {
    subscriber.onPlatform(
        TenantCriado.class,
        "isolamento-tenant-criado",
        e ->
            observe(
                TenantId.of(e.getTenantId()),
                IsolationLevel.parse(e.getNivelIsolamento().name()),
                e.getVersao()));
    subscriber.onPlatform(
        TenantAlterado.class,
        "isolamento-tenant-alterado",
        e ->
            observe(
                TenantId.of(e.getTenantId()),
                IsolationLevel.parse(e.getNivelIsolamento().name()),
                e.getVersao()));
    subscriber.setTenantAwaiter(this::awaitReady);
  }

  /**
   * Segura o evento do tenant até a migração acabar. Não devolve o evento ao Pulsar: cada nack
   * contaria como tentativa e, numa migração longa, o evento iria para a dead letter sem nunca ter
   * falhado. Só sai sem o tenant pronto se a thread for interrompida (desligamento).
   */
  void awaitReady(TenantId tenant) {
    while (!placements.awaitReady(tenant, awaitTimeout)) {
      if (Thread.currentThread().isInterrupted()) {
        throw new TenantMigratingException(tenant);
      }
      LOG.warn(
          "Eventos do tenant {} esperam a migração há mais de {}; seguem esperando",
          tenant,
          awaitTimeout);
    }
  }

  public void observe(TenantId tenant, IsolationLevel level, long version) {
    placements.observe(tenant, level, version).ifPresent(p -> migrator.schedule(tenant));
  }

  /** Uma rodada: relê o mapa e assume migrações paradas (dona caiu, desistiu ou falhou). */
  void tick() {
    placements.refresh();
    for (TenantPlacement p : placements.migrating()) {
      TenantId tenant = p.tenantId();
      if (p.attempts() >= ALERT_ATTEMPTS) {
        LOG.error(
            "Migração do tenant {} já falhou {} vezes; o tenant segue com 503 até alguém olhar",
            tenant,
            p.attempts());
      }
      if (!migrator.isRunning(tenant) && placements.claimStale(p)) {
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
   * Sobe antes do servidor web e do EventSubscriber: a releitura periódica já roda quando a
   * primeira requisição chega, e o mapa não envelhece entre a criação do bean e a subida.
   */
  @Override
  public int getPhase() {
    return DEFAULT_PHASE - 4096;
  }
}
