package br.dev.plataforma.tenants;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.spring.web.Caller;
import jakarta.validation.Valid;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * API administrativa de tenants (tenants.yaml). Não recebe X-Tenant-Id: opera sobre o catálogo de
 * tenants, no plano administrativo (ADR-0005). A autorização por papel chega com o gateway.
 */
@RestController
@RequestMapping("/api/v1/tenants")
public class TenantController {

  /** Corpo do POST de promoção. */
  public record Promocao(NivelIsolamento nivelIsolamento) {}

  private final TenantService service;
  private final PulsarNamespaces namespaces;

  public TenantController(TenantService service, PulsarNamespaces namespaces) {
    this.service = service;
    this.namespaces = namespaces;
  }

  @PostMapping
  public ResponseEntity<TenantView> create(@Valid @RequestBody NewTenant request) {
    TenantView created = service.create(request);
    namespaces.provisionQuietly(created); // depois do commit
    return ResponseEntity.created(URI.create("/api/v1/tenants/" + created.id())).body(created);
  }

  @GetMapping
  public TenantView.Page list(
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "20") int limite) {
    return service.list(cursor, limite);
  }

  @GetMapping("/{tenantId}")
  public TenantView get(@PathVariable String tenantId) {
    return service.get(tenantId);
  }

  @PatchMapping("/{tenantId}")
  public TenantView change(@PathVariable String tenantId, @Valid @RequestBody TenantChange change) {
    TenantView changed = service.change(tenantId, change);
    namespaces.provisionQuietly(changed); // plano novo muda os limites do namespace
    return changed;
  }

  /** Sobe o nível de isolamento (ADR-0014); o namespace Pulsar sai depois do commit. */
  @PostMapping("/{tenantId}/promocao")
  public TenantView promote(
      Caller caller, @PathVariable String tenantId, @RequestBody Promocao promocao) {
    // A operação mais pesada do cadastro: confere o papel aqui também, não só no gateway.
    caller.requireAnyRole(Caller.ADMIN);
    TenantView promoted = service.promote(tenantId, promocao.nivelIsolamento());
    namespaces.provisionQuietly(promoted);
    return promoted;
  }
}
