package br.dev.plataforma.status;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.Test;

class PrometheusTextTest {

  static final String PEDIDOS =
      """
      # HELP http_server_requests_seconds
      # TYPE http_server_requests_seconds histogram
      http_server_requests_seconds_bucket{method="GET",status="200",tenant="acme",uri="/api/v1/pedidos",le="0.1"} 90
      http_server_requests_seconds_bucket{method="GET",status="200",tenant="acme",uri="/api/v1/pedidos",le="0.5"} 98
      http_server_requests_seconds_bucket{method="GET",status="200",tenant="acme",uri="/api/v1/pedidos",le="1.0"} 100
      http_server_requests_seconds_bucket{method="GET",status="200",tenant="acme",uri="/api/v1/pedidos",le="+Inf"} 100
      http_server_requests_seconds_count{method="GET",status="200",tenant="acme",uri="/api/v1/pedidos"} 100
      http_server_requests_seconds_count{method="POST",status="503",tenant="acme",uri="/api/v1/pedidos"} 2
      http_server_requests_seconds_bucket{method="GET",status="200",tenant="nenhum",uri="/actuator/prometheus",le="+Inf"} 5000
      http_server_requests_seconds_count{method="GET",status="200",tenant="nenhum",uri="/actuator/prometheus"} 5000
      plataforma_outbox_pendentes{application="pedidos-service"} 3.0
      plataforma_outbox_atraso_seconds{application="pedidos-service"} 1.5
      plataforma_eventos_consumo_seconds_count{assinatura="pagamentos",error="none",evento="pagamento.aprovado",resultado="processado"} 40
      plataforma_eventos_consumo_seconds_count{assinatura="pagamentos",error="none",evento="pagamento.aprovado",resultado="duplicado"} 2
      plataforma_eventos_consumo_seconds_count{assinatura="pagamentos",error="IllegalStateException",evento="pagamento.aprovado",resultado="falha"} 3
      plataforma_eventos_consumo_seconds_count{assinatura="pagamentos",error="IllegalStateException",evento="pagamento.aprovado",resultado="dead-letter"} 1
      jvm_threads_live_threads 42 1700000000000
      linha_quebrada{sem="fim"
      sem_valor
      valor_invalido abc
      """;

  @Test
  void calculaAsMetricasDaPaginaDeSaude() {
    ServiceMetrics m = PrometheusText.parse(PEDIDOS).toServiceMetrics();

    assertThat(m.requests()).isEqualTo(102); // sem as 5000 do Actuator
    assertThat(m.errorRate()).isCloseTo(2.0 / 102, within(1e-9));
    // p99 = posição 99 de 100: entre 0,5 s (98) e 1,0 s (100), na metade.
    assertThat(m.p99Ms()).isCloseTo(750.0, within(1e-6));
    assertThat(m.outboxPending()).isEqualTo(3);
    assertThat(m.outboxLagSeconds()).isEqualTo(1.5);
    assertThat(m.eventsConsumed()).isEqualTo(42);
    assertThat(m.eventsFailed()).isEqualTo(4);
  }

  @Test
  void servicoSemOutboxNemConsumoDeixaNulos() {
    ServiceMetrics m =
        PrometheusText.parse(
                "http_server_requests_seconds_count{status=\"200\",uri=\"/api/v1/me\"} 0\n")
            .toServiceMetrics();

    assertThat(m.requests()).isZero();
    assertThat(m.errorRate()).isZero();
    assertThat(m.p99Ms()).isNull();
    assertThat(m.outboxPending()).isNull();
    assertThat(m.outboxLagSeconds()).isNull();
    assertThat(m.eventsConsumed()).isNull();
    assertThat(m.eventsFailed()).isNull();
  }

  @Test
  void outboxIndisponivelNoServicoFicaNulo() {
    assertThat(
            PrometheusText.parse("plataforma_outbox_pendentes -1\n")
                .toServiceMetrics()
                .outboxPending())
        .isNull();
  }

  @Test
  void quantilAcimaDoMaiorBaldeDaOMaiorLimite() {
    PrometheusText t =
        PrometheusText.parse(
            """
            h_bucket{le="0.1"} 1
            h_bucket{le="+Inf"} 10
            """);
    assertThat(t.quantile("h_bucket", 0.99, l -> true)).isEqualTo(0.1);
    assertThat(t.quantile("outro", 0.99, l -> true)).isNull();
    assertThat(PrometheusText.parse("h_bucket{le=\"+Inf\"} 0").quantile("h_bucket", 0.5, l -> true))
        .isNull();
  }

  @Test
  void rotulosComEscapeEValoresComTimestamp() {
    PrometheusText t =
        PrometheusText.parse(
            "x{a=\"aspas \\\" e \\\\ e \\n\",b=\"2\"} 7 1700000000000\nx{quebrado} 1\n");
    assertThat(t.samples()).hasSize(2);
    assertThat(t.samples().get(0).labels()).containsEntry("a", "aspas \" e \\ e \n");
    assertThat(t.samples().get(0).value()).isEqualTo(7);
    assertThat(t.samples().get(1).labels()).isEmpty();
  }
}
