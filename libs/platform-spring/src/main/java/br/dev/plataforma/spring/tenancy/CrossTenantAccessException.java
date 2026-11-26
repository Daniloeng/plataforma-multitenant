package br.dev.plataforma.spring.tenancy;

/** Tentativa de gravar um documento de um tenant enquanto o contexto é de outro. */
public class CrossTenantAccessException extends IllegalStateException {

  public CrossTenantAccessException(String documentTenant, String contextTenant) {
    super(
        "Documento do tenant '"
            + documentTenant
            + "' gravado no contexto do tenant '"
            + contextTenant
            + "'");
  }
}
