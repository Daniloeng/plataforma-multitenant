package br.dev.plataforma.pedidos;

/** Valor monetário do contrato ({@code Dinheiro} no _comum.yaml): centavos e moeda ISO 4217. */
public record Dinheiro(long centavos, String moeda) {}
