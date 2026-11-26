package br.dev.plataforma.pagamentos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
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

  @Test
  void cursorIdaEVolta() {
    Cursor c = new Cursor(Instant.ofEpochMilli(1_700_000_000_123L), "pag-1");
    assertThat(Cursor.decodificar(c.codificar())).isEqualTo(c);
  }

  @Test
  void cursorInvalidoViraRequisicaoInvalida() {
    assertThatThrownBy(() -> Cursor.decodificar("@@@")).isInstanceOf(RequisicaoInvalida.class);
    assertThatThrownBy(() -> Cursor.decodificar("c2VtLXNlcGFyYWRvcg"))
        .isInstanceOf(RequisicaoInvalida.class);
  }
}
