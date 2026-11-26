package br.dev.plataforma.pedidos;

import br.dev.plataforma.spring.tenancy.TenantOwned;
import java.time.Instant;
import java.util.ArrayList;
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

  /** Marco da saga na linha do tempo do pedido (schema {@code MarcoPedido}). */
  public record Marco(TipoMarco tipo, Instant em, String detalhe) {}

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
  private List<Marco> historico;
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
    this.historico = new ArrayList<>(List.of(new Marco(TipoMarco.CRIADO, agora, null)));
  }

  /** Pagamento aprovado: PENDENTE vira CONFIRMADO. */
  void confirmar(String pagamentoId, Instant agora) {
    this.status = StatusPedido.CONFIRMADO;
    this.pagamentoId = pagamentoId;
    this.atualizadoEm = agora;
    registrar(new Marco(TipoMarco.PAGO, agora, pagamentoId));
  }

  /** Pagamento recusado: anota o motivo do gateway; o cancelamento vem em seguida. */
  void recusar(String motivo, Instant agora) {
    registrar(new Marco(TipoMarco.RECUSADO, agora, motivo));
  }

  void cancelar(MotivoCancelamento motivo, Instant agora) {
    this.status = StatusPedido.CANCELADO;
    this.motivoCancelamento = motivo;
    this.atualizadoEm = agora;
    registrar(new Marco(TipoMarco.CANCELADO, agora, motivo.name()));
  }

  /**
   * pagamento.estornado: anota a devolução uma vez só (o evento pode chegar de novo).
   *
   * @return false se o estorno já estava anotado
   */
  boolean estornar(String pagamentoId, Instant agora) {
    if (marcos().stream().anyMatch(m -> m.tipo() == TipoMarco.ESTORNADO)) {
      return false;
    }
    this.atualizadoEm = agora;
    registrar(new Marco(TipoMarco.ESTORNADO, agora, pagamentoId));
    return true;
  }

  private void registrar(Marco marco) {
    List<Marco> lista = new ArrayList<>(marcos());
    lista.add(marco);
    this.historico = lista;
  }

  /**
   * Marcos do pedido. Pedido gravado antes do Dia 8 não tem histórico: ele é reconstruído do status
   * (criação, mais a confirmação ou o cancelamento na data da última mudança).
   */
  public List<Marco> marcos() {
    if (historico != null) {
      return List.copyOf(historico);
    }
    List<Marco> derivado = new ArrayList<>();
    derivado.add(new Marco(TipoMarco.CRIADO, criadoEm, null));
    if (status == StatusPedido.CONFIRMADO) {
      derivado.add(new Marco(TipoMarco.PAGO, atualizadoEm, pagamentoId));
    } else if (status == StatusPedido.CANCELADO && motivoCancelamento != null) {
      derivado.add(new Marco(TipoMarco.CANCELADO, atualizadoEm, motivoCancelamento.name()));
    }
    return List.copyOf(derivado);
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
