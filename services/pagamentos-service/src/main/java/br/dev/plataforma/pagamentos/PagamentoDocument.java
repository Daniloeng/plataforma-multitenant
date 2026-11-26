package br.dev.plataforma.pagamentos;

import br.dev.plataforma.spring.tenancy.TenantOwned;
import java.time.Instant;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * A cobrança de um pedido: no máximo uma por {@code (tenantId, pedidoId)} (índice único). Também
 * guarda a marca de pedido cancelado: se {@code pedido.cancelado} chega antes de {@code
 * pedido.criado} (tópicos diferentes não têm ordem entre si), o documento nasce só com a marca, sem
 * {@code status}, e a cobrança nunca acontece (ADR-0006).
 */
@Document("pagamentos")
public class PagamentoDocument implements TenantOwned {

  @Id private String id;
  private String tenantId;
  private String pedidoId;
  private String clienteId;
  private StatusPagamento status;
  private Long valorCentavos;
  private String moeda;
  private String motivoRecusa;
  private boolean pedidoCancelado;
  private Instant criadoEm;
  private Instant atualizadoEm;
  @Version private Long version;

  protected PagamentoDocument() {}

  /** Só a marca de cancelamento: o pedido.criado ainda não chegou. */
  static PagamentoDocument marcaDeCancelamento(String id, String pedidoId, Instant agora) {
    PagamentoDocument doc = new PagamentoDocument();
    doc.id = id;
    doc.pedidoId = pedidoId;
    doc.pedidoCancelado = true;
    doc.criadoEm = agora;
    doc.atualizadoEm = agora;
    return doc;
  }

  /** Grava o resultado da cobrança num documento novo (a marca de cancelamento nunca é cobrada). */
  void cobrar(
      String pedidoId,
      String clienteId,
      long valorCentavos,
      String moeda,
      GatewayPagamento.Resultado resultado,
      Instant agora) {
    this.pedidoId = pedidoId;
    this.clienteId = clienteId;
    this.valorCentavos = valorCentavos;
    this.moeda = moeda;
    this.status = resultado.aprovado() ? StatusPagamento.APROVADO : StatusPagamento.RECUSADO;
    this.motivoRecusa = resultado.motivo();
    this.criadoEm = agora;
    this.atualizadoEm = agora;
  }

  static PagamentoDocument novo(String id) {
    PagamentoDocument doc = new PagamentoDocument();
    doc.id = id;
    return doc;
  }

  /** Marca o pedido como cancelado; true se o pagamento aprovado precisa ser estornado. */
  boolean cancelarPedido(Instant agora) {
    this.pedidoCancelado = true;
    this.atualizadoEm = agora;
    if (status == StatusPagamento.APROVADO) {
      status = StatusPagamento.ESTORNADO;
      return true;
    }
    return false;
  }

  /** Já tem resultado de cobrança (aprovado, recusado ou estornado). */
  boolean cobrado() {
    return status != null;
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

  public String getPedidoId() {
    return pedidoId;
  }

  public String getClienteId() {
    return clienteId;
  }

  public StatusPagamento getStatus() {
    return status;
  }

  public Long getValorCentavos() {
    return valorCentavos;
  }

  public String getMoeda() {
    return moeda;
  }

  public String getMotivoRecusa() {
    return motivoRecusa;
  }

  public boolean isPedidoCancelado() {
    return pedidoCancelado;
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
}
