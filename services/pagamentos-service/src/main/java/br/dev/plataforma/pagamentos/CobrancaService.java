package br.dev.plataforma.pagamentos;

import br.dev.plataforma.contracts.pagamentos.PagamentoAprovado;
import br.dev.plataforma.contracts.pagamentos.PagamentoEstornado;
import br.dev.plataforma.contracts.pagamentos.PagamentoRecusado;
import br.dev.plataforma.contracts.pedidos.PedidoCancelado;
import br.dev.plataforma.contracts.pedidos.PedidoCriado;
import br.dev.plataforma.spring.outbox.Outbox;
import br.dev.plataforma.spring.tenancy.TenantQueries;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.stereotype.Service;

/**
 * As decisões sobre dinheiro da saga (ADR-0006, ADR-0012). Roda dentro da transação do consumidor
 * ({@code EventSubscriber}): pagamento, lançamentos e evento no outbox entram juntos ou não entram.
 * Os eventos de pagamento usam o {@code pedidoId} como agregado da chave da mensagem: com um
 * pagamento por pedido, isso só facilita correlacionar os eventos com o pedido.
 */
@Service
public class CobrancaService {

  private final MongoOperations mongo;
  private final Outbox outbox;
  private final GatewayPagamento gateway;
  private final Clock clock;

  public CobrancaService(
      MongoOperations mongo, Outbox outbox, GatewayPagamento gateway, Clock clock) {
    this.mongo = mongo;
    this.outbox = outbox;
    this.gateway = gateway;
    this.clock = clock;
  }

  /** pedido.criado: cobra uma vez só; pedido já cancelado nunca é cobrado. */
  public void cobrar(PedidoCriado pedido) {
    PagamentoDocument doc = doPedido(pedido.getPedidoId());
    if (doc != null && (doc.cobrado() || doc.isPedidoCancelado())) {
      return; // reentrega, ou cancelamento que chegou antes: nada a cobrar
    }
    Instant agora = agora();
    GatewayPagamento.Resultado resultado =
        gateway.autorizarECapturar(
            chave(pedido.getTenantId(), pedido.getPedidoId()),
            pedido.getTotalCentavos(),
            pedido.getMoeda());
    PagamentoDocument pagamento = PagamentoDocument.novo(UUID.randomUUID().toString());
    pagamento.cobrar(
        pedido.getPedidoId(),
        pedido.getClienteId(),
        pedido.getTotalCentavos(),
        pedido.getMoeda(),
        resultado,
        agora);
    PagamentoDocument salvo = mongo.insert(pagamento);
    if (resultado.aprovado()) {
      lancar(salvo, Lancamento.Conta.CAIXA_GATEWAY, Lancamento.Conta.RECEITA_TENANT, agora);
      outbox.append(
          PagamentoAprovado.newBuilder()
              .setEventId(UUID.randomUUID())
              .setTenantId(salvo.getTenantId())
              .setOccurredAt(agora)
              .setPagamentoId(salvo.getId())
              .setPedidoId(salvo.getPedidoId())
              .setValorCentavos(salvo.getValorCentavos())
              .setMoeda(salvo.getMoeda())
              .setChaveIdempotencia(chave(salvo.getTenantId(), salvo.getPedidoId()))
              .build(),
          salvo.getPedidoId());
    } else {
      outbox.append(
          PagamentoRecusado.newBuilder()
              .setEventId(UUID.randomUUID())
              .setTenantId(salvo.getTenantId())
              .setOccurredAt(agora)
              .setPagamentoId(salvo.getId())
              .setPedidoId(salvo.getPedidoId())
              .setMotivo(salvo.getMotivoRecusa())
              .build(),
          salvo.getPedidoId());
    }
  }

  /**
   * pedido.cancelado: estorna o que foi capturado; se a cobrança ainda não aconteceu, deixa a marca
   * que a impede. Recusado não tem o que estornar.
   */
  public void cancelar(PedidoCancelado pedido) {
    PagamentoDocument doc = doPedido(pedido.getPedidoId());
    Instant agora = agora();
    if (doc == null) {
      mongo.insert(
          PagamentoDocument.marcaDeCancelamento(
              UUID.randomUUID().toString(), pedido.getPedidoId(), agora));
      return;
    }
    if (doc.isPedidoCancelado()) {
      return;
    }
    boolean estornar = doc.cancelarPedido(agora);
    PagamentoDocument salvo = mongo.save(doc);
    if (estornar) {
      lancar(salvo, Lancamento.Conta.ESTORNOS, Lancamento.Conta.CAIXA_GATEWAY, agora);
      outbox.append(
          PagamentoEstornado.newBuilder()
              .setEventId(UUID.randomUUID())
              .setTenantId(salvo.getTenantId())
              .setOccurredAt(agora)
              .setPagamentoId(salvo.getId())
              .setPedidoId(salvo.getPedidoId())
              .setValorCentavos(salvo.getValorCentavos())
              .setMoeda(salvo.getMoeda())
              .build(),
          salvo.getPedidoId());
    }
  }

  /** Partida dobrada: débito numa conta e crédito na outra, mesmo valor. */
  private void lancar(
      PagamentoDocument p, Lancamento.Conta debito, Lancamento.Conta credito, Instant agora) {
    mongo.insert(lancamento(p, debito, Lancamento.Natureza.DEBITO, agora));
    mongo.insert(lancamento(p, credito, Lancamento.Natureza.CREDITO, agora));
  }

  private static Lancamento lancamento(
      PagamentoDocument p, Lancamento.Conta conta, Lancamento.Natureza natureza, Instant agora) {
    return new Lancamento(
        UUID.randomUUID().toString(),
        p.getId(),
        p.getPedidoId(),
        conta,
        natureza,
        p.getValorCentavos(),
        p.getMoeda(),
        agora);
  }

  private PagamentoDocument doPedido(String pedidoId) {
    return mongo.findOne(
        TenantQueries.scoped(Criteria.where("pedidoId").is(pedidoId)), PagamentoDocument.class);
  }

  static String chave(String tenantId, String pedidoId) {
    return tenantId + ":" + pedidoId;
  }

  private Instant agora() {
    return clock.instant().truncatedTo(ChronoUnit.MILLIS);
  }
}
