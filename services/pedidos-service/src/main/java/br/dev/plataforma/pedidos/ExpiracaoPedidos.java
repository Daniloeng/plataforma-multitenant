package br.dev.plataforma.pedidos;

import br.dev.plataforma.core.TenantId;
import br.dev.plataforma.spring.isolation.TenantMigratingException;
import br.dev.plataforma.spring.isolation.TenantPlacement;
import br.dev.plataforma.spring.isolation.TenantPlacements;
import br.dev.plataforma.spring.tenancy.TenantContext;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
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
  private final ObjectProvider<TenantPlacements> placements;

  public ExpiracaoPedidos(
      MongoOperations mongo,
      PedidoService pedidos,
      Clock clock,
      @Value("${plataforma.pedidos.expiracao:PT15M}") Duration prazo,
      ObjectProvider<TenantPlacements> placements) {
    this.mongo = mongo;
    this.pedidos = pedidos;
    this.clock = clock;
    this.prazo = prazo;
    this.placements = placements;
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

  /**
   * Expira um lote de pedidos vencidos da database padrão e um de cada database dedicada
   * (ADR-0014); devolve quantos foram cancelados.
   */
  int expirarVencidos() {
    TenantPlacements mapa = placements.getIfAvailable();
    List<TenantPlacement> dedicados = mapa == null ? List.of() : mapa.dedicated();
    // Na padrão, só os tenants do POOL: o que sobrou de um tenant migrando não é expirado ali.
    Query daPadrao = vencidos();
    if (!dedicados.isEmpty()) {
      daPadrao.addCriteria(
          Criteria.where("tenantId")
              .nin(dedicados.stream().map(TenantPlacement::tenantId).toList()));
    }
    List<PedidoDocument> lote = new ArrayList<>(mongo.find(daPadrao, PedidoDocument.class));
    for (TenantPlacement p : dedicados) {
      if (p.migrating()) {
        continue; // a próxima rodada pega, já na database nova
      }
      try {
        lote.addAll(
            TenantContext.callAsUnchecked(
                TenantId.of(p.tenantId()), () -> mongo.find(vencidos(), PedidoDocument.class)));
      } catch (RuntimeException e) {
        LOG.debug(
            "Expiração do tenant {} fica para a próxima rodada: {}", p.tenantId(), e.toString());
      }
    }
    return expirar(lote);
  }

  private Query vencidos() {
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
    return vencidos;
  }

  private int expirar(List<PedidoDocument> lote) {
    int expirados = 0;
    for (PedidoDocument p : lote) {
      try {
        if (TenantContext.callAsUnchecked(
            TenantId.of(p.getTenantId()), () -> pedidos.expirar(p.getId()))) {
          expirados++;
        }
      } catch (DataAccessException | TransactionException | TenantMigratingException e) {
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
