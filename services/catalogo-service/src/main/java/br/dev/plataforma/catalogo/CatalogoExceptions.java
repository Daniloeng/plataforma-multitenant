package br.dev.plataforma.catalogo;

/** Erros de negócio do catálogo, traduzidos em Problem Details pelo {@link ApiErrors}. */
final class CatalogoExceptions {

  private CatalogoExceptions() {}

  static final class NaoEncontrado extends RuntimeException {
    NaoEncontrado(String id) {
      super("Produto '" + id + "' não encontrado neste tenant.");
    }
  }

  static final class SkuDuplicado extends RuntimeException {
    SkuDuplicado(String sku) {
      super("Já existe um produto com o SKU '" + sku + "' neste tenant.");
    }
  }

  static final class LimiteDoPlano extends RuntimeException {
    LimiteDoPlano(String plano, int limite) {
      super(
          "O plano "
              + plano
              + " permite até "
              + limite
              + " produtos. Desative ou mude de plano para cadastrar mais.");
    }
  }

  static final class TenantSuspenso extends RuntimeException {
    TenantSuspenso() {
      super("O tenant está suspenso: o catálogo fica só para leitura até a reativação.");
    }
  }

  static final class RequisicaoInvalida extends RuntimeException {
    RequisicaoInvalida(String message) {
      super(message);
    }
  }
}
