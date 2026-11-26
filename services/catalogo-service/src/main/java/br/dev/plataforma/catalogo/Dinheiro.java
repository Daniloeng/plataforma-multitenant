package br.dev.plataforma.catalogo;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * Valor monetário do contrato ({@code Dinheiro} no _comum.yaml): centavos e moeda ISO 4217.
 *
 * @param moeda opcional na entrada; o padrão é BRL
 */
public record Dinheiro(
    @NotNull @PositiveOrZero Long centavos, @Pattern(regexp = "^[A-Z]{3}$") String moeda) {

  public Dinheiro {
    moeda = moeda == null ? "BRL" : moeda;
  }
}
