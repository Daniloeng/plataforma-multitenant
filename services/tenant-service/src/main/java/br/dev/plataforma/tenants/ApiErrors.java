package br.dev.plataforma.tenants;

import com.mongodb.MongoException;
import java.net.URI;
import java.util.stream.Collectors;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.data.mongodb.UncategorizedMongoDbException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * Traduz erros em Problem Details (RFC 9457). Os demais erros do Spring MVC (método não suportado,
 * parâmetro com tipo errado) já saem nesse formato pelo {@link ResponseEntityExceptionHandler}.
 */
@RestControllerAdvice
public class ApiErrors extends ResponseEntityExceptionHandler {

  static final String BASE = "https://plataforma.dev.br/problemas/";

  @ExceptionHandler(TenantExceptions.NotFound.class)
  ProblemDetail notFound(TenantExceptions.NotFound e) {
    return problem(HttpStatus.NOT_FOUND, "nao-encontrado", "Tenant não encontrado", e.getMessage());
  }

  @ExceptionHandler(TenantExceptions.AlreadyExists.class)
  ProblemDetail alreadyExists(TenantExceptions.AlreadyExists e) {
    return problem(HttpStatus.CONFLICT, "conflito", "Tenant já existe", e.getMessage());
  }

  /** Dois POSTs iguais ao mesmo tempo: o segundo bate na chave única do _id. */
  @ExceptionHandler(DuplicateKeyException.class)
  ProblemDetail duplicateKey(DuplicateKeyException e) {
    return problem(
        HttpStatus.CONFLICT, "conflito", "Tenant já existe", "Já existe um tenant com esse id.");
  }

  @ExceptionHandler(OptimisticLockingFailureException.class)
  ProblemDetail concurrentChange(OptimisticLockingFailureException e) {
    return problem(
        HttpStatus.CONFLICT,
        "conflito",
        "Alteração concorrente",
        "O tenant mudou durante a alteração; leia de novo e repita.");
  }

  @ExceptionHandler(TenantExceptions.LevelChangeNotSupported.class)
  ProblemDetail levelChange(TenantExceptions.LevelChangeNotSupported e) {
    return problem(
        HttpStatus.CONFLICT, "conflito", "Mudança de nível não suportada", e.getMessage());
  }

  /**
   * Duas transações gravando o mesmo documento ao mesmo tempo: o MongoDB aborta uma delas com
   * WriteConflict (rótulo TransientTransactionError), que o Spring não traduz para
   * DuplicateKeyException nem OptimisticLockingFailureException. Para o cliente é o mesmo 409.
   */
  @ExceptionHandler({TransientDataAccessException.class, UncategorizedMongoDbException.class})
  ProblemDetail transientConflict(DataAccessException e) {
    if (!isTransientTransactionError(e)) {
      throw e;
    }
    return problem(
        HttpStatus.CONFLICT,
        "conflito",
        "Alteração concorrente",
        "Outra requisição alterou o mesmo tenant ao mesmo tempo; repita a operação.");
  }

  static boolean isTransientTransactionError(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof MongoException m
          && (m.hasErrorLabel(MongoException.TRANSIENT_TRANSACTION_ERROR_LABEL)
              || m.getCode() == 112)) {
        return true;
      }
    }
    return e instanceof TransientDataAccessException;
  }

  @ExceptionHandler(TenantExceptions.InvalidRequest.class)
  ProblemDetail invalid(TenantExceptions.InvalidRequest e) {
    return problem(
        HttpStatus.BAD_REQUEST, "requisicao-invalida", "Requisição inválida", e.getMessage());
  }

  /** Campo inválido: lista campo e motivo, em português (mensagens do Bean Validation). */
  @Override
  protected ResponseEntity<Object> handleMethodArgumentNotValid(
      MethodArgumentNotValidException ex,
      HttpHeaders headers,
      HttpStatusCode status,
      WebRequest request) {
    String detail =
        ex.getBindingResult().getFieldErrors().stream()
            .map(f -> f.getField() + ": " + f.getDefaultMessage())
            .sorted()
            .collect(Collectors.joining("; "));
    return ResponseEntity.badRequest()
        .body(problem(status, "requisicao-invalida", "Requisição inválida", detail));
  }

  /** JSON malformado ou valor fora do enum (ex.: plano "OURO"). */
  @Override
  protected ResponseEntity<Object> handleHttpMessageNotReadable(
      HttpMessageNotReadableException ex,
      HttpHeaders headers,
      HttpStatusCode status,
      WebRequest request) {
    return ResponseEntity.badRequest()
        .body(
            problem(
                status,
                "requisicao-invalida",
                "Requisição inválida",
                "Corpo ilegível: confira o JSON e os valores permitidos de plano e"
                    + " nivelIsolamento."));
  }

  static ProblemDetail problem(HttpStatusCode status, String type, String title, String detail) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
    problem.setType(URI.create(BASE + type));
    problem.setTitle(title);
    return problem;
  }
}
