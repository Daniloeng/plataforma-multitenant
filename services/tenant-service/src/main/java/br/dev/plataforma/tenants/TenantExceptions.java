package br.dev.plataforma.tenants;

/**
 * Erros de negócio do cadastro de tenants, traduzidos em Problem Details pelo {@link ApiErrors}.
 */
final class TenantExceptions {

  private TenantExceptions() {}

  static final class NotFound extends RuntimeException {
    NotFound(String id) {
      super("Tenant '" + id + "' não encontrado.");
    }
  }

  static final class AlreadyExists extends RuntimeException {
    AlreadyExists(String id) {
      super("Já existe um tenant com o id '" + id + "'.");
    }
  }

  static final class LevelChangeNotSupported extends RuntimeException {
    LevelChangeNotSupported(String id) {
      super(
          "O nível de isolamento de '"
              + id
              + "' não muda por PATCH: use POST /api/v1/tenants/"
              + id
              + "/promocao.");
    }
  }

  static final class InvalidLevel extends RuntimeException {
    InvalidLevel(String id, Object atual, Object pedido) {
      super(
          "O tenant '"
              + id
              + "' está em "
              + atual
              + ": a promoção só sobe de nível (POOL → BRIDGE → SILO), e "
              + pedido
              + " não é maior.");
    }
  }

  static final class InvalidRequest extends RuntimeException {
    InvalidRequest(String message) {
      super(message);
    }
  }
}
