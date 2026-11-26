package br.dev.plataforma.pedidos;

import br.dev.plataforma.contracts.catalogo.PrecoAlterado;
import br.dev.plataforma.contracts.catalogo.ProdutoAlterado;
import br.dev.plataforma.spring.events.EventSubscriber;
import br.dev.plataforma.spring.tenancy.TenantQueries;
import java.util.function.Predicate;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;

/**
 * Mantém a cópia local do catálogo ({@link ProdutoLocal}) com os eventos do catalogo-service
 * (ADR-0010). Cada evento traz o estado completo da sua metade e a {@code versao}; versão menor ou
 * igual à guardada é ignorada.
 */
@Configuration(proxyBeanMethods = false)
public class CatalogoEventos {

  static final String PRODUTO = "produto-alterado";
  static final String PRECO = "preco-alterado";

  @Bean
  SmartInitializingSingleton catalogoEventHandlers(
      EventSubscriber subscriber, MongoOperations mongo) {
    return () ->
        subscriber
            .on(
                ProdutoAlterado.class,
                PRODUTO,
                e ->
                    aplicar(
                        mongo,
                        e.getTenantId(),
                        e.getProdutoId(),
                        p ->
                            p.aplicarProduto(e.getSku(), e.getNome(), e.getAtivo(), e.getVersao())))
            .on(
                PrecoAlterado.class,
                PRECO,
                e ->
                    aplicar(
                        mongo,
                        e.getTenantId(),
                        e.getProdutoId(),
                        p ->
                            p.aplicarPreco(
                                e.getSku(), e.getPrecoCentavos(), e.getMoeda(), e.getVersao())));
  }

  /**
   * Lê (ou cria) a cópia do produto, aplica a mudança e grava se ela foi aceita. Roda na transação
   * do consumidor; consulta antes de inserir, porque chave duplicada aborta a transação.
   */
  static void aplicar(
      MongoOperations mongo, String tenantId, String produtoId, Predicate<ProdutoLocal> mudanca) {
    String id = ProdutoLocal.chave(tenantId, produtoId);
    ProdutoLocal atual =
        mongo.findOne(TenantQueries.scoped(Criteria.where("_id").is(id)), ProdutoLocal.class);
    boolean novo = atual == null;
    ProdutoLocal produto = novo ? new ProdutoLocal(tenantId, produtoId) : atual;
    if (!mudanca.test(produto)) {
      return;
    }
    if (novo) {
      mongo.insert(produto);
    } else {
      mongo.save(produto);
    }
  }
}
