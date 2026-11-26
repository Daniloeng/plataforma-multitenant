package br.dev.plataforma.gateway;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.reactive.error.ErrorWebExceptionHandler;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Erros que o gateway não escreve sozinho (rota inexistente, serviço fora do ar, tempo esgotado)
 * saem em Problem Details, como o resto da plataforma, e não no JSON padrão do Spring Boot.
 */
@Component
@Order(-2) // antes do DefaultErrorWebExceptionHandler (-1)
public class ProblemErrorHandler implements ErrorWebExceptionHandler {

  private static final Logger LOG = LoggerFactory.getLogger(ProblemErrorHandler.class);

  private final ObjectMapper json;

  public ProblemErrorHandler(ObjectMapper json) {
    this.json = json;
  }

  @Override
  public Mono<Void> handle(ServerWebExchange exchange, Throwable ex) {
    if (exchange.getResponse().isCommitted()) {
      return Mono.error(ex);
    }
    HttpStatus status =
        ex instanceof ResponseStatusException rse
            ? HttpStatus.resolve(rse.getStatusCode().value())
            : null;
    if (status == null) {
      status = HttpStatus.SERVICE_UNAVAILABLE; // serviço fora do ar, conexão recusada
    }
    String type;
    String title;
    String detail;
    if (status == HttpStatus.NOT_FOUND) {
      type = "nao-encontrado";
      title = "Não encontrado";
      detail = "Nenhuma API em " + exchange.getRequest().getPath().value() + ".";
    } else if (status.is5xxServerError()) {
      LOG.warn("Falha ao encaminhar {}: {}", exchange.getRequest().getPath(), ex.toString());
      type = "indisponivel";
      title = "Serviço indisponível";
      detail = "O serviço de destino não respondeu; tente de novo em instantes.";
    } else {
      type = "requisicao-invalida";
      title = status.getReasonPhrase();
      detail = ex instanceof ResponseStatusException rse ? rse.getReason() : null;
    }
    return Problems.write(exchange, json, Problems.of(status, type, title, detail));
  }
}
