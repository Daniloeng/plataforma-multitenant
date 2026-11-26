package br.dev.plataforma.gateway;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Quem está chamando, lido do token do Keycloak.
 *
 * @param usuario {@code preferred_username}
 * @param nome {@code name}
 * @param papeis papéis de realm da plataforma ({@code realm_access.roles}, só os conhecidos)
 * @param clienteId cliente B2B do comprador ({@code cliente_id}), se houver (ADR-0007)
 * @param tenants tenants do usuário: grupos do Keycloak sob {@code /tenants/} (a claim {@code
 *     tenants} traz o caminho completo; outros grupos são ignorados)
 */
public record Identity(
    String usuario, String nome, List<String> papeis, String clienteId, List<String> tenants) {

  public static final String ADMIN = "plataforma-admin";
  static final Set<String> PAPEIS = Set.of(ADMIN, "gestor-tenant", "comprador");

  public static Identity from(Jwt jwt) {
    return new Identity(
        firstNonBlank(jwt.getClaimAsString("preferred_username"), jwt.getSubject()),
        firstNonBlank(jwt.getClaimAsString("name"), jwt.getClaimAsString("preferred_username")),
        roles(jwt),
        jwt.getClaimAsString("cliente_id"),
        tenantGroups(jwt.getClaim("tenants")));
  }

  /** Papéis de realm, filtrados pelos que a plataforma conhece (o Keycloak adiciona os seus). */
  static List<String> roles(Jwt jwt) {
    Object realmAccess = jwt.getClaim("realm_access");
    if (realmAccess instanceof Map<?, ?> map) {
      return stringList(map.get("roles")).stream().filter(PAPEIS::contains).sorted().toList();
    }
    return List.of();
  }

  static final String TENANT_GROUP_PREFIX = "/tenants/";

  /**
   * Só grupos sob {@code /tenants/} viram tenant: um grupo {@code /departamentos/globex} não pode
   * dar acesso ao tenant globex.
   */
  static List<String> tenantGroups(Object claim) {
    return stringList(claim).stream()
        .filter(g -> g.startsWith(TENANT_GROUP_PREFIX))
        .map(g -> g.substring(TENANT_GROUP_PREFIX.length()))
        .filter(t -> !t.isBlank() && !t.contains("/"))
        .distinct()
        .sorted()
        .toList();
  }

  public boolean isAdmin() {
    return papeis.contains(ADMIN);
  }

  /** Administradores operam qualquer tenant; os demais, só os do próprio token. */
  public boolean canAccess(String tenantId) {
    return isAdmin() || tenants.contains(tenantId);
  }

  private static List<String> stringList(Object value) {
    if (value instanceof Collection<?> c) {
      return c.stream().map(String::valueOf).toList();
    }
    if (value instanceof String s && !s.isBlank()) {
      return List.of(s);
    }
    return List.of();
  }

  private static String firstNonBlank(String a, String b) {
    return a != null && !a.isBlank() ? a : b;
  }
}
