package br.dev.plataforma.pedidos;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * Corpo do POST (schema {@code NovoPedido}): só produto e quantidade. Campos só de leitura que o
 * cliente mande (sku, nome, precoUnitario) são ignorados: o preço vem do catálogo.
 */
public record NovoPedido(@NotNull @Size(min = 1, max = 200) List<@Valid @NotNull Item> itens) {

  public record Item(@NotBlank String produtoId, @NotNull @Min(1) @Max(10000) Integer quantidade) {}
}
