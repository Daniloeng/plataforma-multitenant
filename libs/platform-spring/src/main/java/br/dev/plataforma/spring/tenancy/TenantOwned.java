package br.dev.plataforma.spring.tenancy;

/**
 * Documento MongoDB que pertence a um tenant. O {@link TenantGuard} preenche o {@code tenantId} a
 * partir do contexto ao gravar e recusa gravar documento de outro tenant.
 */
public interface TenantOwned {

  String getTenantId();

  void setTenantId(String tenantId);
}
