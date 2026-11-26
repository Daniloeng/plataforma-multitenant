package br.dev.plataforma.pedidos;

import br.dev.plataforma.spring.isolation.TenantPlacement;
import br.dev.plataforma.spring.isolation.TenantPlacements;
import br.dev.plataforma.spring.tenancy.TenantContext;
import br.dev.plataforma.spring.web.Caller;
import java.time.Instant;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Onde o pedidos-service guarda os dados do tenant (ADR-0014): nível, database e se a migração de
 * nível está em andamento. Só gestor e admin: o comprador não precisa saber da infraestrutura.
 */
@RestController
public class IsolamentoController {

  /** Schema {@code Isolamento} do pedidos.yaml. */
  public record Isolamento(
      String tenantId, String nivel, String database, String situacao, Instant migradoEm) {

    static Isolamento of(TenantPlacement p) {
      return new Isolamento(
          p.tenantId().value(),
          p.level().name(),
          p.database(),
          p.migrating() ? "MIGRANDO" : "PRONTO",
          p.migratedAt());
    }
  }

  private final TenantPlacements placements;

  public IsolamentoController(TenantPlacements placements) {
    this.placements = placements;
  }

  @GetMapping("/api/v1/isolamento/pedidos")
  public Isolamento isolamento(Caller caller) {
    caller.requireAnyRole(Caller.GESTOR, Caller.ADMIN);
    return Isolamento.of(placements.of(TenantContext.require()));
  }
}
