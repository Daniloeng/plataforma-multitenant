package br.dev.plataforma.tenants;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mongodb.MongoException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.TransientDataAccessResourceException;
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
  void codigo112SemRotuloEExcecaoTransitoriaDoSpringTambem() {
    assertThat(
            ApiErrors.isTransientTransactionError(
                new UncategorizedMongoDbException("x", new MongoException(112, "WriteConflict"))))
        .isTrue();
    assertThat(errors.transientConflict(new TransientDataAccessResourceException("x")).getStatus())
        .isEqualTo(409);
  }

  @Test
  void outroErroDoMongoNaoViraConflito() {
    var outro = new UncategorizedMongoDbException("x", new MongoException(13, "Unauthorized"));
    assertThat(ApiErrors.isTransientTransactionError(outro)).isFalse();
    assertThatThrownBy(() -> errors.transientConflict(outro)).isSameAs(outro);
  }
}
