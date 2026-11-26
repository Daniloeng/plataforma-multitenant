package br.dev.plataforma.tenants;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import java.time.Instant;
import java.util.List;

/** Representação pública de um tenant (schema {@code Tenant}); não expõe a versão interna. */
public record TenantView(
    String id,
    String nome,
    Plano plano,
    NivelIsolamento nivelIsolamento,
    boolean ativo,
    Instant criadoEm) {

  static TenantView of(TenantDocument doc) {
    return new TenantView(
        doc.id(), doc.nome(), doc.plano(), doc.nivelIsolamento(), doc.ativo(), doc.criadoEm());
  }

  /** Página da listagem: {@code proximoCursor} nulo indica a última página. */
  public record Page(List<TenantView> itens, String proximoCursor) {}
}
