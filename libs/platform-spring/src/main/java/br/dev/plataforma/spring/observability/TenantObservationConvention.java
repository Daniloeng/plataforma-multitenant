package br.dev.plataforma.spring.observability;

import br.dev.plataforma.core.TenantId;
import io.micrometer.common.KeyValue;
import io.micrometer.common.KeyValues;
import org.springframework.http.server.observation.DefaultServerRequestObservationConvention;
import org.springframework.http.server.observation.ServerRequestObservationContext;

/**
 * Acrescenta a tag {@code tenant} às métricas e spans das requisições HTTP ({@code
 * http_server_requests_seconds}), para ver latência e erros por tenant (ADR-0015). O valor vem do
 * {@code X-Tenant-Id} que o gateway escreveu; fora do formato vira {@code invalido}, para um
 * cabeçalho forjado não criar séries sem fim no Prometheus.
 */
public class TenantObservationConvention extends DefaultServerRequestObservationConvention {

  static final String NONE = "nenhum";
  static final String INVALID = "invalido";

  @Override
  public KeyValues getLowCardinalityKeyValues(ServerRequestObservationContext context) {
    return super.getLowCardinalityKeyValues(context)
        .and(KeyValue.of("tenant", tenantTag(context.getCarrier().getHeader("X-Tenant-Id"))));
  }

  static String tenantTag(String header) {
    if (header == null || header.isBlank()) {
      return NONE;
    }
    try {
      return TenantId.of(header).value();
    } catch (IllegalArgumentException e) {
      return INVALID;
    }
  }
}
