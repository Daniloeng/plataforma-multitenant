package br.dev.plataforma.catalogo;

import br.dev.plataforma.spring.tenancy.TenantOwned;
import java.time.Instant;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * Produto de um tenant. O SKU é único dentro do tenant (índice {@code ux_tenant_sku}), e a ordem da
 * listagem é por SKU. Preço em centavos (CLAUDE.md: dinheiro é {@code long}).
 */
@Document("produtos")
public class ProdutoDocument implements TenantOwned {

  @Id private String id;
  private String tenantId;
  private String sku;
  private String nome;
  private long precoCentavos;
  private String moeda;
  private boolean ativo;
  private Instant criadoEm;
  private Instant atualizadoEm;
  @Version private Long version;

  protected ProdutoDocument() {}

  ProdutoDocument(
      String id, String sku, String nome, long precoCentavos, String moeda, Instant agora) {
    this.id = id;
    this.sku = sku;
    this.nome = nome;
    this.precoCentavos = precoCentavos;
    this.moeda = moeda;
    this.ativo = true;
    this.criadoEm = agora;
    this.atualizadoEm = agora;
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

  public String getSku() {
    return sku;
  }

  public String getNome() {
    return nome;
  }

  public long getPrecoCentavos() {
    return precoCentavos;
  }

  public String getMoeda() {
    return moeda;
  }

  public boolean isAtivo() {
    return ativo;
  }

  public Instant getCriadoEm() {
    return criadoEm;
  }

  public Instant getAtualizadoEm() {
    return atualizadoEm;
  }

  public Long getVersion() {
    return version;
  }

  /** Muda nome e/ou situação; devolve true se algo mudou de fato. */
  boolean alterar(String novoNome, Boolean novoAtivo, Instant agora) {
    boolean mudou = false;
    if (novoNome != null && !novoNome.equals(nome)) {
      nome = novoNome;
      mudou = true;
    }
    if (novoAtivo != null && novoAtivo != ativo) {
      ativo = novoAtivo;
      mudou = true;
    }
    if (mudou) {
      atualizadoEm = agora;
    }
    return mudou;
  }

  /** Muda o preço; devolve true se mudou de fato. */
  boolean alterarPreco(long centavos, String novaMoeda, Instant agora) {
    if (centavos == precoCentavos && novaMoeda.equals(moeda)) {
      return false;
    }
    precoCentavos = centavos;
    moeda = novaMoeda;
    atualizadoEm = agora;
    return true;
  }
}
