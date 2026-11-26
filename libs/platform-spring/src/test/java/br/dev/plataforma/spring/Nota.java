package br.dev.plataforma.spring;

import br.dev.plataforma.spring.tenancy.TenantOwned;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

/** Documento de teste que pertence a um tenant. */
@Document("notas")
class Nota implements TenantOwned {
  @Id String id;
  String tenantId;
  String texto;

  Nota(String id, String tenantId, String texto) {
    this.id = id;
    this.tenantId = tenantId;
    this.texto = texto;
  }

  @Override
  public String getTenantId() {
    return tenantId;
  }

  @Override
  public void setTenantId(String tenantId) {
    this.tenantId = tenantId;
  }
}
