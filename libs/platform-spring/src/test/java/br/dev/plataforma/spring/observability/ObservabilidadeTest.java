package br.dev.plataforma.spring.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.micrometer.common.KeyValue;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import io.micrometer.tracing.Span;
import io.micrometer.tracing.TraceContext;
import io.micrometer.tracing.Tracer;
import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class ObservabilidadeTest {

  @Test
  void tagDeTenantVemDoCabecalhoValidado() {
    assertThat(TenantObservationConvention.tenantTag(null)).isEqualTo("nenhum");
    assertThat(TenantObservationConvention.tenantTag(" ")).isEqualTo("nenhum");
    assertThat(TenantObservationConvention.tenantTag("acme")).isEqualTo("acme");
    assertThat(TenantObservationConvention.tenantTag("ACME; drop")).isEqualTo("invalido");
  }

  @Test
  void requisicaoGanhaATagDeTenant() {
    MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/pedidos");
    req.addHeader("X-Tenant-Id", "globex");
    var ctx = new ServerRequestObservationContext(req, new MockHttpServletResponse());

    assertThat(new TenantObservationConvention().getLowCardinalityKeyValues(ctx))
        .contains(KeyValue.of("tenant", "globex"));
  }

  @Test
  void traceparentNoFormatoW3c() {
    Tracer tracer = mock(Tracer.class);
    assertThat(ObservabilityAutoConfiguration.traceparent(null)).isNull();
    assertThat(ObservabilityAutoConfiguration.traceparent(tracer)).isNull(); // sem span

    Span span = mock(Span.class);
    TraceContext ctx = mock(TraceContext.class);
    when(tracer.currentSpan()).thenReturn(span);
    when(span.context()).thenReturn(ctx);
    when(ctx.traceId()).thenReturn("");
    assertThat(ObservabilityAutoConfiguration.traceparent(tracer)).isNull();

    when(ctx.traceId()).thenReturn("4bf92f3577b34da6a3ce929d0e0e4736");
    when(ctx.spanId()).thenReturn("00f067aa0ba902b7");
    when(ctx.sampled()).thenReturn(true);
    assertThat(ObservabilityAutoConfiguration.traceparent(tracer))
        .isEqualTo("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
    when(ctx.sampled()).thenReturn(null);
    assertThat(ObservabilityAutoConfiguration.traceparent(tracer)).endsWith("-00");
  }

  @Test
  void semOutboxNemIsolamentoNaoRegistraMetricas() {
    var registro = new SimpleMeterRegistry();
    new PlatformMetrics(null, null, null, null, Clock.systemUTC()).bindTo(registro);
    assertThat(registro.getMeters()).isEmpty();
  }

  @Test
  void mongoForaDoArViraValorInvalidoSemExcecao() {
    var mongo = mock(org.springframework.data.mongodb.core.MongoOperations.class);
    when(mongo.count(
            org.mockito.ArgumentMatchers.any(
                org.springframework.data.mongodb.core.query.Query.class),
            org.mockito.ArgumentMatchers.<Class<?>>any()))
        .thenThrow(new IllegalStateException("fora do ar"));
    var registro = new SimpleMeterRegistry();
    new PlatformMetrics(mongo, null, null, null, Clock.systemUTC()).bindTo(registro);

    assertThat(registro.get("plataforma.outbox.pendentes").gauge().value()).isEqualTo(-1);
    assertThat(registro.get("plataforma.outbox.atraso").gauge().value()).isNaN();
  }
}
