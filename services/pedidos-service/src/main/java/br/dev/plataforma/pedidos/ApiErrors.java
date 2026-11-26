package br.dev.plataforma.pedidos;

import br.dev.plataforma.spring.isolation.TenantMigratingException;
import br.dev.plataforma.spring.web.ForbiddenException;
import com.mongodb.MongoException;
import java.net.URI;
import java.util.stream.Collectors;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
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

  @ExceptionHandler(PedidosExceptions.NaoEncontrado.class)
  ProblemDetail naoEncontrado(PedidosExceptions.NaoEncontrado e) {
    return problem(HttpStatus.NOT_FOUND, "nao-encontrado", "Pedido não encontrado", e.getMessage());
  }

  @ExceptionHandler(LinhaDoTempo.MuitasConexoes.class)
  ProblemDetail muitasConexoes(LinhaDoTempo.MuitasConexoes e) {
    return problem(
        HttpStatus.TOO_MANY_REQUESTS, "muitas-conexoes", "Muitas conexões abertas", e.getMessage());
  }

  /** Promoção de nível em andamento (ADR-0014): leva segundos, o cliente tenta de novo. */
  @ExceptionHandler(TenantMigratingException.class)
  ResponseEntity<ProblemDetail> tenantEmMigracao(TenantMigratingException e) {
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
        .header(HttpHeaders.RETRY_AFTER, "1")
        .body(
            problem(
                HttpStatus.SERVICE_UNAVAILABLE,
                "tenant-em-migracao",
                "Tenant em migração",
                e.getMessage()));
  }

  @ExceptionHandler(LinhaDoTempo.Indisponivel.class)
  ProblemDetail linhaIndisponivel(LinhaDoTempo.Indisponivel e) {
    return problem(
        HttpStatus.SERVICE_UNAVAILABLE, "indisponivel", "Serviço indisponível", e.getMessage());
  }

  @ExceptionHandler(PedidosExceptions.ChaveReutilizada.class)
  ProblemDetail chaveReutilizada(PedidosExceptions.ChaveReutilizada e) {
    return problem(
        HttpStatus.CONFLICT, "chave-reutilizada", "Idempotency-Key reutilizada", e.getMessage());
  }

  @ExceptionHandler(PedidosExceptions.ProdutoIndisponivel.class)
  ProblemDetail produtoIndisponivel(PedidosExceptions.ProdutoIndisponivel e) {
    ProblemDetail problem =
        problem(
            HttpStatus.CONFLICT, "produto-indisponivel", "Produto indisponível", e.getMessage());
    problem.setProperty("produtos", e.produtos());
    return problem;
  }

  @ExceptionHandler(PedidosExceptions.JaCancelado.class)
  ProblemDetail jaCancelado(PedidosExceptions.JaCancelado e) {
    return problem(
        HttpStatus.CONFLICT, "pedido-ja-cancelado", "Pedido já cancelado", e.getMessage());
  }

  /**
   * Dois POSTs simultâneos com a mesma Idempotency-Key: o segundo bate no índice único
   * ux_idempotencia. Repetir a chamada devolve o pedido criado pelo primeiro.
   */
  @ExceptionHandler(DuplicateKeyException.class)
  ProblemDetail chaveDuplicada(DuplicateKeyException e) {
    return problem(
        HttpStatus.CONFLICT,
        "conflito",
        "Pedido em criação",
        "Outra requisição com a mesma Idempotency-Key está criando este pedido; repita em instantes.");
  }

  @ExceptionHandler(PedidosExceptions.TenantSuspenso.class)
  ProblemDetail tenantSuspenso(PedidosExceptions.TenantSuspenso e) {
    return problem(HttpStatus.FORBIDDEN, "tenant-suspenso", "Tenant suspenso", e.getMessage());
  }

  @ExceptionHandler(ForbiddenException.class)
  ProblemDetail semPermissao(ForbiddenException e) {
    return problem(HttpStatus.FORBIDDEN, "acesso-negado", "Acesso negado", e.getMessage());
  }

  @ExceptionHandler(OptimisticLockingFailureException.class)
  ProblemDetail alteracaoConcorrente(OptimisticLockingFailureException e) {
    return problem(
        HttpStatus.CONFLICT,
        "conflito",
        "Alteração concorrente",
        "O pedido mudou durante a operação; leia de novo e repita.");
  }

  /**
   * Duas transações gravando o mesmo documento ao mesmo tempo: o MongoDB aborta uma delas com
   * WriteConflict (rótulo TransientTransactionError), que o Spring não traduz para
   * DuplicateKeyException nem OptimisticLockingFailureException. Para o cliente é o mesmo 409.
   */
  // O WriteConflict (código 112) chega como DataIntegrityViolationException em gravações dentro de
  // transação; a DuplicateKeyException, subclasse dela, tem handler próprio e mais específico.
  @ExceptionHandler({
    TransientDataAccessException.class,
    UncategorizedMongoDbException.class,
    DataIntegrityViolationException.class
  })
  ProblemDetail transientConflict(DataAccessException e) {
    if (e instanceof DataIntegrityViolationException && !isWriteConflict(e)) {
      // Violação de dado (ex.: validação do documento) não é indisponibilidade: segue como 500.
      throw e;
    }
    if (!isWriteConflict(e)) {
      // Timeout ou banco indisponível não é edição concorrente: 503, para o cliente tentar depois.
      logger.warn("Falha de acesso ao MongoDB", e);
      return problem(
          HttpStatus.SERVICE_UNAVAILABLE,
          "indisponivel",
          "Serviço indisponível",
          "O banco de dados não respondeu; tente de novo em instantes.");
    }
    return problem(
        HttpStatus.CONFLICT,
        "conflito",
        "Alteração concorrente",
        "Outra requisição alterou o mesmo pedido ao mesmo tempo (ou criou um pedido com a mesma"
            + " Idempotency-Key); repita a operação.");
  }

  static final int WRITE_CONFLICT = 112;

  static boolean isWriteConflict(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      // Só o WriteConflict (112): o rótulo TransientTransactionError também marca queda de rede e
      // troca de primário, que são indisponibilidade (503), não edição concorrente.
      if (t instanceof MongoException m && m.getCode() == WRITE_CONFLICT) {
        return true;
      }
    }
    return false;
  }

  @ExceptionHandler(PedidosExceptions.RequisicaoInvalida.class)
  ProblemDetail invalid(PedidosExceptions.RequisicaoInvalida e) {
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

  /** JSON malformado ou quantidade que não é número inteiro. */
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
                "Corpo ilegível: confira o JSON (itens com produtoId e quantidade inteira)."));
  }

  static ProblemDetail problem(HttpStatusCode status, String type, String title, String detail) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
    problem.setType(URI.create(BASE + type));
    problem.setTitle(title);
    return problem;
  }
}
