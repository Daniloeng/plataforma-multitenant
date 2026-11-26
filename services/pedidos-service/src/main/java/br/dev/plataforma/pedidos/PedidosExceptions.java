package br.dev.plataforma.pedidos;

import java.util.List;

/** Erros de negócio dos pedidos, traduzidos em Problem Details pelo {@link ApiErrors}. */
final class PedidosExceptions {

  private PedidosExceptions() {}

  static final class NaoEncontrado extends RuntimeException {
    NaoEncontrado(String id) {
      super("Pedido '" + id + "' não encontrado.");
    }
  }

  static final class ChaveReutilizada extends RuntimeException {
    ChaveReutilizada() {
      super(
          "Esta Idempotency-Key já criou um pedido com outro conteúdo. Gere uma chave nova para um"
              + " pedido novo.");
    }
  }

  static final class ProdutoIndisponivel extends RuntimeException {
    private final List<String> produtos;

    ProdutoIndisponivel(List<String> produtos) {
      super(
          "Produto indisponível (inexistente, inativo ou sem preço no catálogo): "
              + String.join(", ", produtos)
              + ".");
      this.produtos = List.copyOf(produtos);
    }

    List<String> produtos() {
      return produtos;
    }
  }

  static final class JaCancelado extends RuntimeException {
    JaCancelado(String id) {
      super("O pedido '" + id + "' já está cancelado.");
    }
  }

  static final class RequisicaoInvalida extends RuntimeException {
    RequisicaoInvalida(String message) {
      super(message);
    }
  }
}
