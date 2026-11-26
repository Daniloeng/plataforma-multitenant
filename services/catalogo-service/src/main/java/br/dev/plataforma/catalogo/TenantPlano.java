package br.dev.plataforma.catalogo;

import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.spring.tenancy.TenantOwned;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * O que o catálogo sabe de cada tenant, aprendido pelos eventos tenant.criado e tenant.alterado
 * (banco por serviço: o catálogo nunca lê o MongoDB do tenant-service). Só guarda o que usa: o
 * plano, para o limite de produtos.
 *
 * @see TenantEventos
 */
@Document("tenants")
public class TenantPlano implements TenantOwned {

  @Id private String id;
  private String tenantId;
  private Plano plano;
  private boolean ativo;
  private long versao;

  protected TenantPlano() {}

  TenantPlano(String tenantId, Plano plano, boolean ativo, long versao) {
    this.id = tenantId;
    this.tenantId = tenantId;
    this.plano = plano;
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

  public Plano getPlano() {
    return plano;
  }

  public boolean isAtivo() {
    return ativo;
  }

  public long getVersao() {
    return versao;
  }
}
