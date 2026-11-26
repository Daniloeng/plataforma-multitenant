package br.dev.plataforma.gateway;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;

/**
 * O que o gateway sabe de um tenant: vem dos eventos tenant.* e da listagem inicial.
 *
 * @param versao versão do cadastro; o diretório só aceita versões maiores (eventos fora de ordem)
 */
public record TenantInfo(
    String id,
    String nome,
    Plano plano,
    NivelIsolamento nivelIsolamento,
    boolean ativo,
    long versao) {}
