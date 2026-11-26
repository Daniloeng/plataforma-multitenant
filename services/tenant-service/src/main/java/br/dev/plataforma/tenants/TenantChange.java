package br.dev.plataforma.tenants;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import jakarta.validation.constraints.Size;

/** Corpo do PATCH (schema {@code AlteracaoTenant}): campos nulos não mudam. */
public record TenantChange(
    @Size(min = 2, max = 120) String nome,
    Plano plano,
    NivelIsolamento nivelIsolamento,
    Boolean ativo) {

  /** O contrato exige ao menos uma propriedade ({@code minProperties: 1}). */
  boolean isEmpty() {
    return nome == null && plano == null && nivelIsolamento == null && ativo == null;
  }
}
