package br.dev.plataforma.tenants;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Corpo do POST /api/v1/tenants (schema {@code NovoTenant} do tenants.yaml).
 *
 * @param nivelIsolamento opcional; o padrão é POOL
 */
public record NewTenant(
    @NotNull @Pattern(regexp = "^[a-z][a-z0-9-]{1,38}[a-z0-9]$") String id,
    @NotBlank @Size(min = 2, max = 120) String nome,
    @NotNull Plano plano,
    NivelIsolamento nivelIsolamento) {}
