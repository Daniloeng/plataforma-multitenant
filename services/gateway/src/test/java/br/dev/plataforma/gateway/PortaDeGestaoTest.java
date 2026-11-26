package br.dev.plataforma.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;

class PortaDeGestaoTest {

  private static boolean casa(int porta, InetSocketAddress local) {
    var req = MockServerHttpRequest.get("/actuator/prometheus");
    if (local != null) {
      req.localAddress(local);
    }
    return SecurityConfig.managementPort(porta)
        .matches(MockServerWebExchange.from(req.build()))
        .block()
        .isMatch();
  }

  @Test
  void soAPortaDeGestaoLiberaAsMetricas() {
    assertThat(casa(8001, new InetSocketAddress("127.0.0.1", 8001))).isTrue();
    assertThat(casa(8001, new InetSocketAddress("127.0.0.1", 8000))).isFalse();
    assertThat(casa(8001, null)).isFalse();
    assertThat(casa(-1, new InetSocketAddress("127.0.0.1", 8001))).isFalse();
  }
}
