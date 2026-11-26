package br.dev.plataforma.catalogo;

import jakarta.validation.constraints.Size;

/** Corpo do PATCH /api/v1/produtos/{id} (schema {@code AlteracaoProduto}). */
public record AlteracaoProduto(@Size(min = 2, max = 200) String nome, Boolean ativo) {

  boolean vazia() {
    return nome == null && ativo == null;
  }
}
