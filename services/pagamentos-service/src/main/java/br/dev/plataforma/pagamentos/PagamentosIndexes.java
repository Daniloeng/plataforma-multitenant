package br.dev.plataforma.pagamentos;

import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.index.Index;

/**
 * Índices (que também criam as coleções) antes de os consumidores começarem: coleção criada dentro
 * da transação do primeiro evento faria dois eventos simultâneos abortarem um ao outro.
 */
@Configuration(proxyBeanMethods = false)
public class PagamentosIndexes {

  @Bean
  SmartInitializingSingleton pagamentosIndices(MongoOperations mongo) {
    return () -> {
      // No máximo uma cobrança (ou marca de cancelamento) por pedido: a corrida entre pedido.criado
      // e pedido.cancelado cai aqui, e a transação que perde é refeita pelo consumidor.
      mongo
          .indexOps(PagamentoDocument.class)
          .createIndex(
              new Index()
                  .on("tenantId", Sort.Direction.ASC)
                  .on("pedidoId", Sort.Direction.ASC)
                  .unique()
                  .named("ux_pedido"));
      mongo
          .indexOps(PagamentoDocument.class)
          .createIndex(
              new Index()
                  .on("tenantId", Sort.Direction.ASC)
                  .on("criadoEm", Sort.Direction.DESC)
                  .on("_id", Sort.Direction.DESC)
                  .named("ix_tenant_recentes"));
      mongo
          .indexOps(Lancamento.class)
          .createIndex(
              new Index()
                  .on("tenantId", Sort.Direction.ASC)
                  .on("ocorridoEm", Sort.Direction.DESC)
                  .on("_id", Sort.Direction.DESC)
                  .named("ix_tenant_extrato"));
    };
  }
}
