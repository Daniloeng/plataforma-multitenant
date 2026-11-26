package br.dev.plataforma.pedidos;

import br.dev.plataforma.core.TenantId;
import br.dev.plataforma.spring.tenancy.TenantContext;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.TransactionException;

/**
 * Compensação por tempo da saga (ADR-0006): pedido PENDENTE há mais que o prazo (15 min) é
 * cancelado com EXPIRADO, para não ficar preso se o pagamento nunca responder (ex.: evento no dead
 * letter). A busca passa por todos os tenants; cada cancelamento roda no tenant do pedido. Com
 * várias réplicas, duas podem pegar o mesmo pedido: a releitura e o {@code @Version} fazem uma só
 * vencer. Um pedido que falha por erro inesperado sai das próximas rodadas desta réplica (até
 * reiniciar), para não ocupar o lote e impedir os outros de expirar.
 */
@Component
public class ExpiracaoPedidos {

  private static final Logger LOG = LoggerFactory.getLogger(ExpiracaoPedidos.class);
  static final int LOTE = 100;
  static final int MAX_COM_ERRO = 1000;

  private final Set<String> comErro = ConcurrentHashMap.newKeySet();

  private final MongoOperations mongo;
  private final PedidoService pedidos;
  private final Clock clock;
  private final Duration prazo;

  public ExpiracaoPedidos(
      MongoOperations mongo,
      PedidoService pedidos,
      Clock clock,
      @Value("${plataforma.pedidos.expiracao:PT15M}") Duration prazo) {
    this.mongo = mongo;
    this.pedidos = pedidos;
    this.clock = clock;
    this.prazo = prazo;
  }

  @Scheduled(
      fixedDelayString = "${plataforma.pedidos.expiracao-intervalo:PT1M}",
      initialDelayString = "${plataforma.pedidos.expiracao-intervalo:PT1M}")
  public void executar() {
    int expirados = expirarVencidos();
    if (expirados > 0) {
      LOG.info("{} pedidos PENDENTES expirados", expirados);
    }
  }

  /** Expira um lote de pedidos vencidos; devolve quantos foram cancelados. */
  int expirarVencidos() {
    Query vencidos =
        Query.query(
                Criteria.where("status")
                    .is(StatusPedido.PENDENTE)
                    .and("criadoEm")
                    .lt(clock.instant().minus(prazo))
                    .and("_id")
                    .nin(comErro))
            .with(Sort.by("criadoEm"))
            .limit(LOTE);
    vencidos.fields().include("_id", "tenantId");
    List<PedidoDocument> lote = mongo.find(vencidos, PedidoDocument.class);
    int expirados = 0;
    for (PedidoDocument p : lote) {
      try {
        if (TenantContext.callAsUnchecked(
            TenantId.of(p.getTenantId()), () -> pedidos.expirar(p.getId()))) {
          expirados++;
        }
      } catch (DataAccessException | TransactionException e) {
        // Pagamento ou outra réplica mexeu no pedido ao mesmo tempo: a próxima rodada decide.
        LOG.debug("Pedido {} não expirou agora: {}", p.getId(), e.toString());
      } catch (RuntimeException e) {
        // Um pedido com problema não pode travar a expiração dos outros do lote.
        LOG.warn("Pedido {} não pôde ser expirado; fica fora das próximas rodadas", p.getId(), e);
        if (comErro.size() < MAX_COM_ERRO) {
          comErro.add(p.getId());
        }
      }
    }
    return expirados;
  }
}
