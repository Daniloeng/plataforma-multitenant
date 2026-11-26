package br.dev.plataforma.spring.tenancy;

/** Operação que exige tenant foi executada sem tenant no contexto. */
public class MissingTenantException extends IllegalStateException {

  public MissingTenantException() {
    super("Nenhum tenant no contexto: a operação exige X-Tenant-Id ou TenantContext.callAs");
  }
}
