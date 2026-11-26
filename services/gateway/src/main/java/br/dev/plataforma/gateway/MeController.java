package br.dev.plataforma.gateway;

import java.util.List;
import java.util.Optional;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** {@code GET /api/v1/me}: quem é o usuário e a quais tenants ele tem acesso (gateway.yaml). */
@RestController
public class MeController {

  /** Um tenant visível ao usuário, com os dados do cadastro. */
  public record MeTenant(
      String id, String nome, String plano, String nivelIsolamento, boolean ativo) {}

  /** Resposta do /api/v1/me. */
  public record Me(
      String usuario, String nome, List<String> papeis, String clienteId, List<MeTenant> tenants) {}

  private final TenantDirectory directory;

  public MeController(TenantDirectory directory) {
    this.directory = directory;
  }

  @GetMapping("/api/v1/me")
  public Me me(@AuthenticationPrincipal Jwt jwt) {
    Identity identity = Identity.from(jwt);
    List<TenantInfo> visible =
        identity.isAdmin()
            ? directory.all()
            : identity.tenants().stream()
                .map(directory::find)
                .flatMap(Optional::stream)
                .sorted(java.util.Comparator.comparing(TenantInfo::id))
                .toList();
    return new Me(
        identity.usuario(),
        identity.nome(),
        identity.papeis(),
        identity.clienteId(),
        visible.stream()
            .map(
                t ->
                    new MeTenant(
                        t.id(), t.nome(), t.plano().name(), t.nivelIsolamento().name(), t.ativo()))
            .toList());
  }
}
