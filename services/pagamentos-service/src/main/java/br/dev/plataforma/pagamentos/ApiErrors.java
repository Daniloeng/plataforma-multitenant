package br.dev.plataforma.pagamentos;

import br.dev.plataforma.spring.web.ForbiddenException;
import java.net.URI;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.data.mongodb.UncategorizedMongoDbException;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * Traduz erros em Problem Details (RFC 9457). A API só lê, então não há conflito de escrita; os
 * demais erros do Spring MVC (parâmetro com tipo errado) saem pelo {@link
 * ResponseEntityExceptionHandler}.
 */
@RestControllerAdvice
public class ApiErrors extends ResponseEntityExceptionHandler {

  static final String BASE = "https://plataforma.dev.br/problemas/";

  @ExceptionHandler(NaoEncontrado.class)
  ProblemDetail naoEncontrado(NaoEncontrado e) {
    return problem(
        HttpStatus.NOT_FOUND, "nao-encontrado", "Pagamento não encontrado", e.getMessage());
  }

  @ExceptionHandler(ForbiddenException.class)
  ProblemDetail semPermissao(ForbiddenException e) {
    return problem(HttpStatus.FORBIDDEN, "acesso-negado", "Acesso negado", e.getMessage());
  }

  @ExceptionHandler(RequisicaoInvalida.class)
  ProblemDetail invalid(RequisicaoInvalida e) {
    return problem(
        HttpStatus.BAD_REQUEST, "requisicao-invalida", "Requisição inválida", e.getMessage());
  }

  /** MongoDB fora do ar ou lento: o cliente pode tentar de novo. */
  @ExceptionHandler({TransientDataAccessException.class, UncategorizedMongoDbException.class})
  ProblemDetail indisponivel(RuntimeException e) {
    return problem(
        HttpStatus.SERVICE_UNAVAILABLE,
        "indisponivel",
        "Serviço indisponível",
        "Os pagamentos estão indisponíveis no momento. Tente de novo em instantes.");
  }

  static ProblemDetail problem(HttpStatusCode status, String type, String title, String detail) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
    problem.setType(URI.create(BASE + type));
    problem.setTitle(title);
    return problem;
  }
}
