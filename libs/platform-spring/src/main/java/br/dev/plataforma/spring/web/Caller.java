package br.dev.plataforma.spring.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Quem chamou a API, segundo os cabeçalhos que o gateway escreve depois de validar o token
 * (ADR-0009). Os serviços não ficam expostos fora do gateway, então os cabeçalhos são confiáveis.
 * Controllers recebem um {@code Caller} como parâmetro.
 *
 * @param usuario {@code X-Usuario}; null quando a chamada não passou pelo gateway (ex.: testes)
 * @param papeis {@code X-Papeis}, separados por vírgula
 * @param clienteId {@code X-Cliente-Id}, o cliente B2B do comprador (ADR-0007)
 */
public record Caller(String usuario, Set<String> papeis, String clienteId) {

  public static final String USUARIO_HEADER = "X-Usuario";
  public static final String PAPEIS_HEADER = "X-Papeis";
  public static final String CLIENTE_HEADER = "X-Cliente-Id";

  public static final String ADMIN = "plataforma-admin";
  public static final String GESTOR = "gestor-tenant";
  public static final String COMPRADOR = "comprador";

  public Caller {
    papeis = papeis == null ? Set.of() : Set.copyOf(papeis);
  }

  public static Caller from(HttpServletRequest request) {
    String raw = request.getHeader(PAPEIS_HEADER);
    Set<String> papeis =
        raw == null
            ? Set.of()
            : Arrays.stream(raw.split(","))
                .map(String::strip)
                .filter(p -> !p.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    return new Caller(
        blankToNull(request.getHeader(USUARIO_HEADER)),
        papeis,
        blankToNull(request.getHeader(CLIENTE_HEADER)));
  }

  public boolean hasAnyRole(String... roles) {
    return Arrays.stream(roles).anyMatch(papeis::contains);
  }

  /** Gestor do tenant ou administrador da plataforma: quem pode alterar dados do tenant. */
  public boolean canManage() {
    return hasAnyRole(GESTOR, ADMIN);
  }

  /** Lança {@link ForbiddenException} se nenhum dos papéis estiver presente. */
  public void requireAnyRole(String... roles) {
    if (!hasAnyRole(roles)) {
      throw new ForbiddenException(
          "Esta operação exige o papel " + String.join(" ou ", roles) + ".");
    }
  }

  private static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s.strip();
  }
}
