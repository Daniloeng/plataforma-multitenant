package br.dev.plataforma.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.ConnectException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.ResponseStatusException;

class ProblemErrorHandlerTest {

  private final ProblemErrorHandler handler = new ProblemErrorHandler(new ObjectMapper());

  private static MockServerWebExchange exchange() {
    return MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/tenants"));
  }

  @Test
  void servicoForaDoArVira503Indisponivel() {
    var ex = exchange();
    handler.handle(ex, new ConnectException("Connection refused")).block();
    assertThat(ex.getResponse().getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    assertThat(ex.getResponse().getBodyAsString().block()).contains("problemas/indisponivel");
  }

  @Test
  void statusDoSpringViraProblemaComOMesmoCodigo() {
    var ex = exchange();
    handler
        .handle(ex, new ResponseStatusException(HttpStatus.METHOD_NOT_ALLOWED, "só GET"))
        .block();
    assertThat(ex.getResponse().getStatusCode()).isEqualTo(HttpStatus.METHOD_NOT_ALLOWED);
    assertThat(ex.getResponse().getBodyAsString().block())
        .contains("requisicao-invalida")
        .contains("só GET");
  }

  @Test
  void timeoutDoDestinoVira503() {
    var ex = exchange();
    handler.handle(ex, new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT)).block();
    assertThat(ex.getResponse().getStatusCode()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);
    assertThat(ex.getResponse().getBodyAsString().block()).contains("indisponivel");
  }

  @Test
  void respostaJaEnviadaNaoEReescrita() {
    var ex = exchange();
    ex.getResponse().setComplete().block();
    var erro = new IllegalStateException("x");
    assertThatThrownBy(() -> handler.handle(ex, erro).block()).isSameAs(erro);
  }

  @Test
  void limiteZeroERecusadoNaConfiguracao() {
    assertThatThrownBy(() -> new GatewayProperties.Limit(10, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new GatewayProperties.Limit(0, 10))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
