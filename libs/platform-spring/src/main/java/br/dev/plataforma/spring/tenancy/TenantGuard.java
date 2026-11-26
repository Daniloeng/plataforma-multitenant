package br.dev.plataforma.spring.tenancy;

import java.util.Optional;
import org.springframework.data.mongodb.core.mapping.event.AbstractMongoEventListener;
import org.springframework.data.mongodb.core.mapping.event.AfterConvertEvent;
import org.springframework.data.mongodb.core.mapping.event.BeforeConvertEvent;

/**
 * Antes de gravar um {@link TenantOwned}: sem tenantId, usa o do contexto (que é obrigatório); com
 * tenantId diferente do contexto, recusa. Depois de ler, faz a mesma conferência: um documento de
 * outro tenant carregado por uma consulta sem filtro (ex.: {@code findById}) lança exceção em vez
 * de vazar. É a última barreira; as consultas continuam filtrando por tenant ({@link
 * TenantQueries}).
 */
public class TenantGuard extends AbstractMongoEventListener<TenantOwned> {

  @Override
  public void onAfterConvert(AfterConvertEvent<TenantOwned> event) {
    TenantOwned doc = event.getSource();
    TenantContext.current()
        .map(Object::toString)
        .filter(ctx -> !ctx.equals(doc.getTenantId()))
        .ifPresent(
            ctx -> {
              throw new CrossTenantAccessException(String.valueOf(doc.getTenantId()), ctx);
            });
  }

  @Override
  public void onBeforeConvert(BeforeConvertEvent<TenantOwned> event) {
    TenantOwned doc = event.getSource();
    Optional<String> context = TenantContext.current().map(Object::toString);
    if (doc.getTenantId() == null) {
      doc.setTenantId(context.orElseThrow(MissingTenantException::new));
      return;
    }
    context
        .filter(ctx -> !ctx.equals(doc.getTenantId()))
        .ifPresent(
            ctx -> {
              throw new CrossTenantAccessException(doc.getTenantId(), ctx);
            });
  }
}
