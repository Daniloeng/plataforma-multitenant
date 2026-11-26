package br.dev.plataforma.pagamentos;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class GatewaySimuladoTest {

  private final GatewaySimulado gateway = new GatewaySimulado(new PagamentosProperties(null));

  @Test
  void aprovaAteOLimitePadrao() {
    assertThat(gateway.autorizarECapturar("k", 1_000_000L, "BRL").aprovado()).isTrue();
  }

  @Test
  void recusaAcimaDoLimiteComMotivoEmReais() {
    GatewayPagamento.Resultado r = gateway.autorizarECapturar("k", 1_000_001L, "BRL");
    assertThat(r.aprovado()).isFalse();
    assertThat(r.motivo())
        .isEqualTo("Valor acima do limite de aprovação do gateway simulado (R$ 10.000,00).");
  }

  @Test
  void respeitaOLimiteConfigurado() {
    GatewaySimulado baixo = new GatewaySimulado(new PagamentosProperties(500L));
    assertThat(baixo.autorizarECapturar("k", 501L, "BRL").motivo()).contains("R$ 5,00");
  }
}
