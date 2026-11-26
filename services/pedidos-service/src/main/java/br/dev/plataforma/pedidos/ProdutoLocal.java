package br.dev.plataforma.pedidos;

import br.dev.plataforma.spring.tenancy.TenantOwned;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * O que o pedidos-service sabe de cada produto, aprendido pelos eventos {@code produto.alterado}
 * (sku, nome, ativo) e {@code preco.alterado} (preço). Banco por serviço: nunca lê o MongoDB do
 * catálogo. Os dois eventos chegam por tópicos diferentes e podem chegar em qualquer ordem, então
 * cada metade guarda a própria versão; enquanto uma metade não chegou, o produto fica indisponível
 * para pedidos.
 *
 * <p>O {@code _id} é {@code tenantId:produtoId}: o id do produto já é único, mas o prefixo deixa
 * explícito que a chave nunca cruza tenants.
 */
@Document("produtos")
public class ProdutoLocal implements TenantOwned {

  /** Versão de uma metade que ainda não chegou: qualquer evento (versão ≥ 0) é mais novo. */
  static final long NENHUMA = -1;

  @Id private String id;
  private String tenantId;
  private String produtoId;
  private String sku;
  private String nome;
  private boolean ativo;
  private long versaoProduto = NENHUMA;
  private Long precoCentavos;
  private String moeda;
  private long versaoPreco = NENHUMA;

  protected ProdutoLocal() {}

  ProdutoLocal(String tenantId, String produtoId) {
    this.id = chave(tenantId, produtoId);
    this.tenantId = tenantId;
    this.produtoId = produtoId;
  }

  static String chave(String tenantId, String produtoId) {
    return tenantId + ":" + produtoId;
  }

  /** Aplica um produto.alterado; false se a versão não for mais nova que a guardada. */
  boolean aplicarProduto(String sku, String nome, boolean ativo, long versao) {
    if (versao <= versaoProduto) {
      return false;
    }
    this.sku = sku;
    this.nome = nome;
    this.ativo = ativo;
    this.versaoProduto = versao;
    return true;
  }

  /** Aplica um preco.alterado; false se a versão não for mais nova que a guardada. */
  boolean aplicarPreco(String sku, long centavos, String moeda, long versao) {
    if (versao <= versaoPreco) {
      return false;
    }
    if (this.sku == null) {
      this.sku = sku;
    }
    this.precoCentavos = centavos;
    this.moeda = moeda;
    this.versaoPreco = versao;
    return true;
  }

  /** Pode entrar num pedido: ativo, com nome e com preço conhecidos. */
  boolean disponivel() {
    return ativo && versaoProduto > NENHUMA && precoCentavos != null;
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

  public String getProdutoId() {
    return produtoId;
  }

  public String getSku() {
    return sku;
  }

  public String getNome() {
    return nome;
  }

  public boolean isAtivo() {
    return ativo;
  }

  public long getVersaoProduto() {
    return versaoProduto;
  }

  public Long getPrecoCentavos() {
    return precoCentavos;
  }

  public String getMoeda() {
    return moeda;
  }

  public long getVersaoPreco() {
    return versaoPreco;
  }
}
