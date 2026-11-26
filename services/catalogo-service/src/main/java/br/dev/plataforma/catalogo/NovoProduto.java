package br.dev.plataforma.catalogo;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Corpo do POST /api/v1/produtos (schema {@code NovoProduto} do catalogo.yaml). */
public record NovoProduto(
    @NotNull @Pattern(regexp = "^[A-Z0-9-]{3,32}$") String sku,
    @NotBlank @Size(min = 2, max = 200) String nome,
    @NotNull @Valid Dinheiro preco) {}
