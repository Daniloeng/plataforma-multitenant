package br.dev.plataforma.catalogo;

import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.index.Index;

/** Índices do catálogo, criados antes de o servidor aceitar requisições. */
@Configuration(proxyBeanMethods = false)
public class CatalogoIndexes {

  @Bean
  SmartInitializingSingleton catalogoIndices(MongoOperations mongo) {
    return () ->
        // SKU único por tenant; também serve à listagem (tenantId + ordem por SKU).
        mongo
            .indexOps(ProdutoDocument.class)
            .createIndex(
                new Index()
                    .on("tenantId", Sort.Direction.ASC)
                    .on("sku", Sort.Direction.ASC)
                    .unique()
                    .named("ux_tenant_sku"));
  }
}
