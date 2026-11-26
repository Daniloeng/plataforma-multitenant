package br.dev.plataforma.gateway;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Respostas de erro do gateway em Problem Details (RFC 9457), com os mesmos tipos da plataforma.
 */
public final class Problems {

  static final String BASE = "https://plataforma.dev.br/problemas/";

  private Problems() {}

  public static ProblemDetail of(HttpStatus status, String type, String title, String detail) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
    problem.setType(URI.create(BASE + type));
    problem.setTitle(title);
    return problem;
  }

  public static Mono<Void> write(
      ServerWebExchange exchange, ObjectMapper json, ProblemDetail problem) {
    problem.setInstance(URI.create(exchange.getRequest().getPath().value()));
    ServerHttpResponse response = exchange.getResponse();
    response.setStatusCode(HttpStatus.valueOf(problem.getStatus()));
    response.getHeaders().setContentType(MediaType.APPLICATION_PROBLEM_JSON);
    byte[] body;
    try {
      body = json.writeValueAsBytes(problem);
    } catch (JsonProcessingException e) {
      body = ("{\"status\":" + problem.getStatus() + "}").getBytes(StandardCharsets.UTF_8);
    }
    return response.writeWith(Mono.just(response.bufferFactory().wrap(body)));
  }
}
