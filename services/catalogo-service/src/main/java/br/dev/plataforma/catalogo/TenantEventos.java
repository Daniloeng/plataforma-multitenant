package br.dev.plataforma.catalogo;

import br.dev.plataforma.contracts.tenants.TenantAlterado;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import br.dev.plataforma.spring.events.EventSubscriber;
import br.dev.plataforma.spring.tenancy.TenantQueries;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;

/**
 * Mantém a cópia local dos planos ({@link TenantPlano}). Os dois eventos trazem o estado completo e
 * a {@code versao}: como estão em tópicos diferentes, podem chegar fora de ordem, e a versão menor
 * ou igual à guardada é ignorada (ADR-0008).
 */
@Configuration(proxyBeanMethods = false)
public class TenantEventos {

  static final String CRIADO = "tenant-criado";
  static final String ALTERADO = "tenant-alterado";

  @Bean
  SmartInitializingSingleton tenantEventHandlers(
      EventSubscriber subscriber, MongoOperations mongo) {
    return () ->
        subscriber
            .on(
                TenantCriado.class,
                CRIADO,
                e ->
                    aplicar(
                        mongo, new TenantPlano(e.getTenantId(), e.getPlano(), true, e.getVersao())))
            .on(
                TenantAlterado.class,
                ALTERADO,
                e ->
                    aplicar(
                        mongo,
                        new TenantPlano(
                            e.getTenantId(), e.getPlano(), e.getAtivo(), e.getVersao())));
  }

  /** Grava se for novo ou mais recente que o guardado. Roda na transação do consumidor. */
  static void aplicar(MongoOperations mongo, TenantPlano novo) {
    Query doTenant = TenantQueries.scoped(Criteria.where("_id").is(novo.getId()));
    TenantPlano atual = mongo.findOne(doTenant, TenantPlano.class);
    if (atual != null && atual.getVersao() >= novo.getVersao()) {
      return;
    }
    if (atual == null) {
      mongo.insert(novo);
    } else {
      mongo.findAndReplace(doTenant, novo);
    }
  }
}
