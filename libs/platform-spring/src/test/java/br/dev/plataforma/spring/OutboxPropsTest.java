package br.dev.plataforma.spring;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class OutboxPropsTest {

  @Test
  void padroesCabemNoLeasePadrao() {
    var props = new PlatformProperties.OutboxProps(null, null, null, 0, null);
    assertThat(props.lease()).isEqualTo(Duration.ofSeconds(10));
    assertThat(props.sendTimeout()).isEqualTo(Duration.ofSeconds(4));
    assertThat(props.enabled()).isTrue();
    assertThat(props.batchSize()).isEqualTo(100);
  }

  @Test
  void leaseCurtoSemSendTimeoutEncurtaOPadrao() {
    var props = new PlatformProperties.OutboxProps(null, null, null, 0, Duration.ofSeconds(6));
    assertThat(props.sendTimeout()).isEqualTo(Duration.ofSeconds(2));
  }

  @Test
  void recusaSendTimeoutQueNaoCabeNaMetadeDoLease() {
    assertThatThrownBy(
            () ->
                new PlatformProperties.OutboxProps(
                    null, null, Duration.ofSeconds(3), 0, Duration.ofSeconds(6)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("send-timeout");
  }
}
