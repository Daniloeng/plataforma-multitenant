package br.dev.plataforma.pagamentos;

import br.dev.plataforma.spring.tenancy.TenantOwned;
import java.time.Instant;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * Uma partida do ledger, imutável: nunca é alterada nem apagada; um estorno é um lançamento novo.
 * Todo movimento grava um débito e um crédito do mesmo valor.
 */
@Document("lancamentos")
public class Lancamento implements TenantOwned {

  /** Contas do ledger (schema {@code Lancamento.conta}). */
  public enum Conta {
    /** Dinheiro a receber do adquirente. */
    CAIXA_GATEWAY,
    /** Receita do tenant com vendas capturadas. */
    RECEITA_TENANT,
    /** Conta redutora da receita: devoluções de pagamentos capturados. */
    ESTORNOS
  }

  public enum Natureza {
    DEBITO,
    CREDITO
  }

  @Id private String id;
  private String tenantId;
  private String pagamentoId;
  private String pedidoId;
  private Conta conta;
  private Natureza natureza;
  private long valorCentavos;
  private String moeda;
  private Instant ocorridoEm;

  protected Lancamento() {}

  Lancamento(
      String id,
      String pagamentoId,
      String pedidoId,
      Conta conta,
      Natureza natureza,
      long valorCentavos,
      String moeda,
      Instant ocorridoEm) {
    this.id = id;
    this.pagamentoId = pagamentoId;
    this.pedidoId = pedidoId;
    this.conta = conta;
    this.natureza = natureza;
    this.valorCentavos = valorCentavos;
    this.moeda = moeda;
    this.ocorridoEm = ocorridoEm;
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

  public String getPagamentoId() {
    return pagamentoId;
  }

  public String getPedidoId() {
    return pedidoId;
  }

  public Conta getConta() {
    return conta;
  }

  public Natureza getNatureza() {
    return natureza;
  }

  public long getValorCentavos() {
    return valorCentavos;
  }

  public String getMoeda() {
    return moeda;
  }

  public Instant getOcorridoEm() {
    return ocorridoEm;
  }
}
