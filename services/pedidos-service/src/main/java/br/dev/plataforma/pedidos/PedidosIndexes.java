package br.dev.plataforma.pedidos;

import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.index.Index;

/**
 * Índices e coleções, criados antes de o servidor aceitar requisições e de os consumidores
 * começarem. Criar a coleção dentro de uma transação, no primeiro evento, faria dois eventos
 * simultâneos abortarem um ao outro com conflito de escrita.
 */
@Configuration(proxyBeanMethods = false)
public class PedidosIndexes {

  @Bean
  SmartInitializingSingleton pedidosIndices(MongoOperations mongo) {
    return () -> {
      // Uma chave de idempotência cria no máximo um pedido por cliente do tenant.
      mongo
          .indexOps(PedidoDocument.class)
          .createIndex(
              new Index()
                  .on("tenantId", Sort.Direction.ASC)
                  .on("clienteId", Sort.Direction.ASC)
                  .on("idempotencyKey", Sort.Direction.ASC)
                  .unique()
                  .named("ux_idempotencia"));
      // Listagem do gestor (todos os clientes) e do comprador (o próprio cliente).
      mongo
          .indexOps(PedidoDocument.class)
          .createIndex(
              new Index()
                  .on("tenantId", Sort.Direction.ASC)
                  .on("criadoEm", Sort.Direction.DESC)
                  .on("_id", Sort.Direction.DESC)
                  .named("ix_tenant_recentes"));
      mongo
          .indexOps(PedidoDocument.class)
          .createIndex(
              new Index()
                  .on("tenantId", Sort.Direction.ASC)
                  .on("clienteId", Sort.Direction.ASC)
                  .on("criadoEm", Sort.Direction.DESC)
                  .on("_id", Sort.Direction.DESC)
                  .named("ix_cliente_recentes"));
      mongo
          .indexOps(ProdutoLocal.class)
          .createIndex(
              new Index()
                  .on("tenantId", Sort.Direction.ASC)
                  .on("produtoId", Sort.Direction.ASC)
                  .named("ix_tenant_produto"));
      if (!mongo.collectionExists(TenantSituacao.class)) {
        mongo.createCollection(TenantSituacao.class);
      }
    };
  }
}
