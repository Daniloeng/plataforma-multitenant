package br.dev.plataforma.tenants;

import static org.assertj.core.api.Assertions.assertThat;

import com.mongodb.MongoException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.mongodb.UncategorizedMongoDbException;
import org.springframework.http.ProblemDetail;

/** Corridas entre transações (WriteConflict) viram 409, não 500. */
class ApiErrorsTest {

  final ApiErrors errors = new ApiErrors();

  @Test
  void writeConflictComRotuloTransitorioVira409() {
    MongoException conflito = new MongoException(112, "WriteConflict");
    conflito.addLabel(MongoException.TRANSIENT_TRANSACTION_ERROR_LABEL);

    ProblemDetail p =
        errors.transientConflict(new UncategorizedMongoDbException("falhou", conflito));

    assertThat(p.getStatus()).isEqualTo(409);
    assertThat(p.getTitle()).isEqualTo("Alteração concorrente");
  }

  @Test
  void codigo112SemRotuloTambemEConflito() {
    assertThat(
            ApiErrors.isWriteConflict(
                new UncategorizedMongoDbException("x", new MongoException(112, "WriteConflict"))))
        .isTrue();
  }

  /** Timeout ou banco fora do ar não é edição concorrente: 503, em Problem Details. */
  @Test
  void outrasFalhasDoBancoViram503() {
    assertThat(errors.transientConflict(new QueryTimeoutException("x")).getStatus()).isEqualTo(503);
    var outro = new UncategorizedMongoDbException("x", new MongoException(13, "Unauthorized"));
    assertThat(ApiErrors.isWriteConflict(outro)).isFalse();
    ProblemDetail p = errors.transientConflict(outro);
    assertThat(p.getStatus()).isEqualTo(503);
    assertThat(p.getType()).hasToString("https://plataforma.dev.br/problemas/indisponivel");
  }
}
