package br.dev.plataforma.spring.tenancy;

import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;

/**
 * Consultas sempre filtradas pelo tenant do contexto. Use em vez de montar {@link Query} solto:
 * {@code mongo.find(TenantQueries.scoped(where("status").is("PENDENTE")), Pedido.class)}.
 */
public final class TenantQueries {

  public static final String FIELD = "tenantId";

  private TenantQueries() {}

  /** Critério {@code tenantId = <tenant do contexto>} combinado com {@code criteria}. */
  public static Query scoped(Criteria criteria) {
    Criteria tenant = Criteria.where(FIELD).is(TenantContext.require().value());
    return Query.query(criteria == null ? tenant : new Criteria().andOperator(tenant, criteria));
  }

  /** Só o filtro de tenant. */
  public static Query scoped() {
    return scoped(null);
  }
}
