package br.dev.plataforma.pagamentos;

/** Pagamento inexistente neste tenant: 404 {@code nao-encontrado}. */
class NaoEncontrado extends RuntimeException {
  NaoEncontrado(String id) {
    super("Pagamento '" + id + "' não encontrado.");
  }
}
