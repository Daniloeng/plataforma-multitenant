package br.dev.plataforma.pedidos;

import br.dev.plataforma.spring.tenancy.TenantOwned;
import java.time.Instant;
import java.util.List;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * Pedido de um cliente B2B dentro de um tenant. Guarda a chave de idempotência e o hash do corpo
 * que o criou: repetir a chave com o mesmo corpo devolve este pedido; com outro corpo, 409.
 */
@Document("pedidos")
public class PedidoDocument implements TenantOwned {

  /** Item com o preço e o nome do produto no momento do pedido. */
  public record Item(
      String produtoId, String sku, String nome, int quantidade, long precoUnitarioCentavos) {}

  @Id private String id;
  private String tenantId;
  private String clienteId;
  private String idempotencyKey;
  private String requestHash;
  private StatusPedido status;
  private List<Item> itens;
  private long totalCentavos;
  private String moeda;
  private String pagamentoId;
  private MotivoCancelamento motivoCancelamento;
  private Instant criadoEm;
  private Instant atualizadoEm;
  @Version private Long version;

  protected PedidoDocument() {}

  PedidoDocument(
      String id,
      String clienteId,
      String idempotencyKey,
      String requestHash,
      List<Item> itens,
      long totalCentavos,
      String moeda,
      Instant agora) {
    this.id = id;
    this.clienteId = clienteId;
    this.idempotencyKey = idempotencyKey;
    this.requestHash = requestHash;
    this.status = StatusPedido.PENDENTE;
    this.itens = List.copyOf(itens);
    this.totalCentavos = totalCentavos;
    this.moeda = moeda;
    this.criadoEm = agora;
    this.atualizadoEm = agora;
  }

  /** Pagamento aprovado: PENDENTE vira CONFIRMADO. */
  void confirmar(String pagamentoId, Instant agora) {
    this.status = StatusPedido.CONFIRMADO;
    this.pagamentoId = pagamentoId;
    this.atualizadoEm = agora;
  }

  void cancelar(MotivoCancelamento motivo, Instant agora) {
    this.status = StatusPedido.CANCELADO;
    this.motivoCancelamento = motivo;
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

  public String getClienteId() {
    return clienteId;
  }

  public String getIdempotencyKey() {
    return idempotencyKey;
  }

  public String getRequestHash() {
    return requestHash;
  }

  public StatusPedido getStatus() {
    return status;
  }

  public List<Item> getItens() {
    return itens;
  }

  public long getTotalCentavos() {
    return totalCentavos;
  }

  public String getMoeda() {
    return moeda;
  }

  public String getPagamentoId() {
    return pagamentoId;
  }

  public MotivoCancelamento getMotivoCancelamento() {
    return motivoCancelamento;
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
