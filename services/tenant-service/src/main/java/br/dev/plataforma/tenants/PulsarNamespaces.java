package br.dev.plataforma.tenants;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.apache.pulsar.client.admin.PulsarAdmin;
import org.apache.pulsar.client.admin.PulsarAdminException;
import org.apache.pulsar.client.api.PulsarClientException;
import org.apache.pulsar.common.policies.data.BacklogQuota;
import org.apache.pulsar.common.policies.data.RetentionPolicies;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.pulsar.core.PulsarAdministration;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Namespace Pulsar próprio para tenant BRIDGE e SILO ({@code plataforma/t-<id>}), com retenção e
 * cota de backlog pelo plano (ADR-0014). Funciona como um reconciliador: tenta logo depois da
 * promoção e, de tempos em tempos, confere todos os tenants dedicados, então uma falha do Pulsar na
 * hora da promoção se corrige sozinha.
 */
@Component
public class PulsarNamespaces {

  private static final Logger LOG = LoggerFactory.getLogger(PulsarNamespaces.class);

  /**
   * Limites por plano: retenção (minutos e MB) e cota de backlog (bytes). O Pulsar exige a cota de
   * backlog menor que a retenção em tamanho.
   */
  record Limites(int retencaoMinutos, int retencaoMb, long backlogBytes) {}

  static final Map<Plano, Limites> LIMITES =
      Map.of(
          Plano.GRATUITO, new Limites(24 * 60, 200, 100L * 1024 * 1024),
          Plano.PROFISSIONAL, new Limites(7 * 24 * 60, 2 * 1024, 1024L * 1024 * 1024),
          Plano.EMPRESARIAL, new Limites(30 * 24 * 60, 20 * 1024, 10L * 1024 * 1024 * 1024));

  private final PulsarAdministration administration;
  private final MongoOperations mongo;

  /** Tenant → plano já aplicado; mudar o plano reaplica os limites. */
  private final Map<String, Plano> aplicados = new ConcurrentHashMap<>();

  public PulsarNamespaces(PulsarAdministration administration, MongoOperations mongo) {
    this.administration = administration;
    this.mongo = mongo;
  }

  static String namespace(String tenantId) {
    return "plataforma/t-" + tenantId;
  }

  static boolean dedicado(NivelIsolamento nivel) {
    return nivel != NivelIsolamento.POOL;
  }

  /** Cria (ou atualiza) o namespace do tenant, se o nível pede. Falha fica para o reconciliador. */
  public void provisionQuietly(TenantView tenant) {
    if (!dedicado(tenant.nivelIsolamento())) {
      return;
    }
    try {
      provision(tenant.id(), tenant.plano());
    } catch (RuntimeException | PulsarAdminException | PulsarClientException e) {
      LOG.warn("Namespace do tenant {} fica para o reconciliador: {}", tenant.id(), e.toString());
    }
  }

  void provision(String tenantId, Plano plano) throws PulsarAdminException, PulsarClientException {
    if (plano == aplicados.get(tenantId)) {
      return;
    }
    Limites limites = LIMITES.get(plano);
    String ns = namespace(tenantId);
    try (PulsarAdmin admin = administration.createAdminClient()) {
      try {
        admin.namespaces().createNamespace(ns);
        LOG.info("Namespace {} criado", ns);
      } catch (PulsarAdminException.ConflictException jaExiste) {
        // Já existe: só reaplica os limites.
      }
      admin
          .namespaces()
          .setRetention(ns, new RetentionPolicies(limites.retencaoMinutos(), limites.retencaoMb()));
      admin
          .namespaces()
          .setBacklogQuota(
              ns,
              BacklogQuota.builder()
                  .limitSize(limites.backlogBytes())
                  .retentionPolicy(BacklogQuota.RetentionPolicy.producer_request_hold)
                  .build());
    }
    aplicados.put(tenantId, plano);
  }

  /** Confere todos os tenants dedicados (poucos; o cache evita chamar o Pulsar à toa). */
  @Scheduled(
      fixedDelayString = "${plataforma.tenants.namespaces-intervalo:PT30S}",
      initialDelayString = "${plataforma.tenants.namespaces-intervalo:PT30S}")
  public void reconcile() {
    List<TenantDocument> dedicados =
        mongo.find(
            Query.query(
                Criteria.where("nivelIsolamento")
                    .in(NivelIsolamento.BRIDGE.name(), NivelIsolamento.SILO.name())),
            TenantDocument.class);
    for (TenantDocument t : dedicados) {
      try {
        provision(t.id(), t.plano());
      } catch (RuntimeException | PulsarAdminException | PulsarClientException e) {
        LOG.warn("Namespace do tenant {} não ficou pronto: {}", t.id(), e.toString());
      }
    }
  }
}
