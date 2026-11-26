package br.dev.plataforma.tenants;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.apache.pulsar.client.admin.PulsarAdmin;
import org.apache.pulsar.client.admin.PulsarAdminException;
import org.apache.pulsar.client.api.PulsarClientException;
import org.apache.pulsar.common.policies.data.BacklogQuota;
import org.apache.pulsar.common.policies.data.RetentionPolicies;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.pulsar.core.PulsarAdministration;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Namespace Pulsar próprio para tenant BRIDGE e SILO ({@code plataforma/t-<id>}), com retenção e
 * cota de backlog pelo plano (ADR-0014). Funciona como um reconciliador: tenta logo depois da
 * promoção (numa thread virtual, sem segurar a resposta) e, de tempos em tempos, reaplica os
 * limites de todos os tenants dedicados, então uma falha do Pulsar na hora da promoção, ou um
 * namespace apagado ou alterado por fora, se corrige sozinho.
 */
@Component
public class PulsarNamespaces implements DisposableBean {

  private static final Logger LOG = LoggerFactory.getLogger(PulsarNamespaces.class);

  /**
   * Limites por plano: retenção (minutos e MB) e cota de backlog (bytes). O Pulsar exige a cota de
   * backlog menor que a retenção em tamanho.
   */
  record Limits(int retentionMinutes, int retentionMb, long backlogBytes) {}

  static final Map<Plano, Limits> LIMITS =
      Map.of(
          Plano.GRATUITO, new Limits(24 * 60, 200, 100L * 1024 * 1024),
          Plano.PROFISSIONAL, new Limits(7 * 24 * 60, 2 * 1024, 1024L * 1024 * 1024),
          Plano.EMPRESARIAL, new Limits(30 * 24 * 60, 20 * 1024, 10L * 1024 * 1024 * 1024));

  private final PulsarAdministration administration;
  private final MongoOperations mongo;

  /** Tenant → plano já aplicado; mudar o plano reaplica os limites. */
  private final Map<String, Plano> applied = new ConcurrentHashMap<>();

  private final ExecutorService async =
      Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("namespace-", 0).factory());

  public PulsarNamespaces(PulsarAdministration administration, MongoOperations mongo) {
    this.administration = administration;
    this.mongo = mongo;
  }

  static String namespace(String tenantId) {
    return "plataforma/t-" + tenantId;
  }

  static boolean dedicated(NivelIsolamento level) {
    return level != NivelIsolamento.POOL;
  }

  /**
   * Cria (ou atualiza) o namespace do tenant, se o nível pede, sem segurar a resposta da API: o
   * Pulsar lento ou fora do ar não atrasa a promoção. Falha fica para o reconciliador.
   */
  public void provisionQuietly(TenantView tenant) {
    if (!dedicated(tenant.nivelIsolamento())) {
      return;
    }
    async.execute(
        () -> {
          try {
            provision(tenant.id(), tenant.plano(), false);
          } catch (RuntimeException | PulsarAdminException | PulsarClientException e) {
            LOG.warn(
                "Namespace do tenant {} fica para o reconciliador: {}", tenant.id(), e.toString());
          }
        });
  }

  /**
   * @param force reaplica mesmo que esta réplica já tenha aplicado o plano (o reconciliador usa,
   *     para consertar um namespace apagado ou mudado por fora)
   */
  void provision(String tenantId, Plano plano, boolean force)
      throws PulsarAdminException, PulsarClientException {
    if (!force && plano == applied.get(tenantId)) {
      return;
    }
    Limits limits = LIMITS.get(plano);
    String ns = namespace(tenantId);
    try (PulsarAdmin admin = administration.createAdminClient()) {
      try {
        admin.namespaces().createNamespace(ns);
        LOG.info("Namespace {} criado", ns);
      } catch (PulsarAdminException.ConflictException alreadyExists) {
        // Já existe: só reaplica os limites.
      }
      admin
          .namespaces()
          .setRetention(ns, new RetentionPolicies(limits.retentionMinutes(), limits.retentionMb()));
      admin
          .namespaces()
          .setBacklogQuota(
              ns,
              BacklogQuota.builder()
                  .limitSize(limits.backlogBytes())
                  .retentionPolicy(BacklogQuota.RetentionPolicy.producer_request_hold)
                  .build());
    }
    applied.put(tenantId, plano);
  }

  /**
   * Reaplica namespace e limites de todos os tenants dedicados (poucos; são chamadas idempotentes
   * de administração, a cada 30 s).
   */
  @Scheduled(
      fixedDelayString = "${plataforma.tenants.namespaces-intervalo:PT30S}",
      initialDelayString = "${plataforma.tenants.namespaces-intervalo:PT30S}")
  public void reconcile() {
    List<TenantDocument> dedicatedTenants =
        mongo.find(
            Query.query(
                Criteria.where("nivelIsolamento")
                    .in(NivelIsolamento.BRIDGE.name(), NivelIsolamento.SILO.name())),
            TenantDocument.class);
    for (TenantDocument t : dedicatedTenants) {
      try {
        provision(t.id(), t.plano(), true);
      } catch (RuntimeException | PulsarAdminException | PulsarClientException e) {
        LOG.warn("Namespace do tenant {} não ficou pronto: {}", t.id(), e.toString());
      }
    }
  }

  @Override
  public void destroy() {
    async.shutdownNow();
  }
}
