package br.dev.plataforma.spring.isolation;

import br.dev.plataforma.core.IsolationLevel;
import br.dev.plataforma.core.TenantId;
import java.time.Instant;

/**
 * Onde ficam os dados de um tenant neste serviço.
 *
 * @param tenantId tenant
 * @param level nível de isolamento mais recente visto em tenant.criado ou tenant.alterado
 * @param database database MongoDB dos dados de negócio do tenant (a padrão no POOL)
 * @param status {@link Status#MIGRATING} enquanto os dados mudam de database
 * @param migratedAt quando a última migração terminou (null se nunca migrou)
 * @param migrationStartedAt último batimento da migração em andamento (lease entre réplicas)
 * @param owner réplica dona da migração em andamento
 * @param attempts tentativas de migração que falharam
 * @param version maior versão do cadastro do tenant já vista
 */
public record TenantPlacement(
    TenantId tenantId,
    IsolationLevel level,
    String database,
    Status status,
    Instant migratedAt,
    Instant migrationStartedAt,
    String owner,
    int attempts,
    long version) {

  /** Situação dos dados do tenant. */
  public enum Status {
    READY,
    MIGRATING
  }

  public boolean migrating() {
    return status == Status.MIGRATING;
  }
}
