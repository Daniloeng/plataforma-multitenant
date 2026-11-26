package br.dev.plataforma.spring.tenancy;

/**
 * Documento MongoDB que pertence a um tenant. O {@link TenantGuard} preenche o {@code tenantId} a
 * partir do contexto ao gravar, recusa gravar documento de outro tenant e recusa devolver, na
 * leitura, documento de outro tenant.
 *
 * <p>O campo é {@code String} (e não {@link br.dev.plataforma.core.TenantId}) porque é o valor
 * gravado no MongoDB e usado nos índices; o formato já foi validado ao entrar no {@code
 * TenantContext}, que só aceita {@code TenantId}.
 */
public interface TenantOwned {

  String getTenantId();

  void setTenantId(String tenantId);
}
