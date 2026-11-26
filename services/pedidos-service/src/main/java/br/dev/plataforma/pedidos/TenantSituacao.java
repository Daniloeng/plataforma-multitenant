package br.dev.plataforma.pedidos;

import br.dev.plataforma.spring.tenancy.TenantOwned;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * O que o pedidos-service sabe de cada tenant, aprendido por tenant.criado e tenant.alterado: só a
 * situação, para recusar pedidos de tenant suspenso mesmo antes de o gateway saber da suspensão.
 */
@Document("tenants")
public class TenantSituacao implements TenantOwned {

  @Id private String id;
  private String tenantId;
  private boolean ativo;
  private long versao;

  protected TenantSituacao() {}

  TenantSituacao(String tenantId, boolean ativo, long versao) {
    this.id = tenantId;
    this.tenantId = tenantId;
    this.ativo = ativo;
    this.versao = versao;
  }

  @Override
  public String getTenantId() {
    return tenantId;
  }

  @Override
  public void setTenantId(String tenantId) {
    this.tenantId = tenantId;
  }

  public String getId() {
    return id;
  }

  public boolean isAtivo() {
    return ativo;
  }

  public long getVersao() {
    return versao;
  }
}
