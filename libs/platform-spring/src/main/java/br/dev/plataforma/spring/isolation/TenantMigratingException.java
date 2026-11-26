package br.dev.plataforma.spring.isolation;

import br.dev.plataforma.core.TenantId;

/**
 * Os dados do tenant estão mudando de database (promoção de nível, ADR-0014). As APIs respondem 503
 * {@code tenant-em-migracao} com Retry-After; os consumidores esperam e, se demorar, tentam de
 * novo.
 */
public class TenantMigratingException extends RuntimeException {

  private final transient TenantId tenantId;

  public TenantMigratingException(TenantId tenantId) {
    super(
        "Os dados do tenant '"
            + tenantId.value()
            + "' estão migrando para outro nível de isolamento; tente de novo em instantes.");
    this.tenantId = tenantId;
  }

  public TenantId tenantId() {
    return tenantId;
  }
}
