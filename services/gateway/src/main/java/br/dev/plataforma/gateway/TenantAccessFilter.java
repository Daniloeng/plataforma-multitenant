package br.dev.plataforma.gateway;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Optional;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * Resolve o tenant de cada requisição e entrega aos serviços a identidade já verificada.
 *
 * <ol>
 *   <li>Descarta os cabeçalhos de identidade que vieram de fora ({@code X-Tenant-Id}, {@code
 *       X-Cliente-Id}, {@code X-Usuario}, {@code X-Papeis}): só o gateway os escreve (ADR-0005).
 *   <li>O cliente escolhe o tenant em {@code X-Tenant-Id}; o gateway confere que ele pertence ao
 *       usuário (claim {@code tenants}), que existe e que está ativo.
 *   <li>Aplica o limite de requisições do plano do tenant (429 com {@code Retry-After}).
 *   <li>Reescreve os cabeçalhos com os valores verificados.
 * </ol>
 *
 * Roda depois da cadeia do Spring Security (ordem -100), que já recusou requisições sem token.
 */
@Component
@Order(0)
public class TenantAccessFilter implements WebFilter {

  static final String TENANT = "X-Tenant-Id";
  static final String CLIENTE = "X-Cliente-Id";
  static final String USUARIO = "X-Usuario";
  static final String PAPEIS = "X-Papeis";

  /** Chave do balde de quem chama sem tenant; tenants válidos não têm ':' no id. */
  static final String USER_BUCKET_PREFIX = "usuario:";

  static final List<String> IDENTITY_HEADERS = List.of(TENANT, CLIENTE, USUARIO, PAPEIS);

  private final TenantDirectory directory;
  private final RateLimiter limiter;
  private final ObjectMapper json;
  private final GatewayProperties.Limit userLimit;

  public TenantAccessFilter(
      TenantDirectory directory, RateLimiter limiter, ObjectMapper json, GatewayProperties props) {
    this.directory = directory;
    this.limiter = limiter;
    this.json = json;
    this.userLimit = props.userLimit();
  }

  @Override
  public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
    String path = exchange.getRequest().getPath().pathWithinApplication().value();
    String requested = trimToNull(exchange.getRequest().getHeaders().getFirst(TENANT));
    ServerWebExchange stripped =
        exchange.mutate().request(r -> r.headers(h -> IDENTITY_HEADERS.forEach(h::remove))).build();
    if (!path.startsWith("/api/v1/")) {
      return chain.filter(stripped);
    }
    return ReactiveSecurityContextHolder.getContext()
        .map(SecurityContext::getAuthentication)
        .filter(JwtAuthenticationToken.class::isInstance)
        .map(a -> Identity.from(((JwtAuthenticationToken) a).getToken()))
        .map(Optional::of)
        .defaultIfEmpty(Optional.empty())
        .flatMap(
            identity ->
                identity.isEmpty()
                    ? chain.filter(stripped)
                    : authorize(stripped, chain, identity.get(), path, requested));
  }

  private Mono<Void> authorize(
      ServerWebExchange exchange,
      WebFilterChain chain,
      Identity identity,
      String path,
      String requested) {
    boolean administrative = path.equals("/api/v1/tenants") || path.startsWith("/api/v1/tenants/");
    boolean tenantOptional = administrative || path.equals("/api/v1/me");
    String tenant = requested;
    if (tenant == null && !administrative && identity.tenants().size() == 1) {
      tenant = identity.tenants().getFirst();
    }
    if (tenant == null || administrative) {
      if (!tenantOptional) {
        return problem(
            exchange,
            HttpStatus.BAD_REQUEST,
            "tenant-invalido",
            "Tenant inválido",
            "Escolha o tenant no cabeçalho X-Tenant-Id.");
      }
      // Sem tenant (administração e /me), o limite é por usuário (plataforma.gateway.user-limit).
      RateLimiter.Decision decision =
          limiter.tryAcquire(USER_BUCKET_PREFIX + identity.usuario(), userLimit);
      return decision.allowed()
          ? chain.filter(withIdentity(exchange, identity, null))
          : tooManyRequests(exchange, decision, "Limite de requisições do usuário excedido.");
    }
    if (!identity.canAccess(tenant)) {
      return problem(
          exchange,
          HttpStatus.FORBIDDEN,
          "acesso-negado",
          "Acesso negado",
          "O tenant '" + tenant + "' não pertence ao seu usuário.");
    }
    Optional<TenantInfo> info = directory.find(tenant);
    if (info.isEmpty()) {
      return directory.isLoaded()
          ? problem(
              exchange,
              HttpStatus.FORBIDDEN,
              "acesso-negado",
              "Acesso negado",
              "Tenant '" + tenant + "' não cadastrado.")
          : problem(
              exchange,
              HttpStatus.SERVICE_UNAVAILABLE,
              "indisponivel",
              "Serviço indisponível",
              "O gateway ainda está carregando o catálogo de tenants; tente de novo.");
    }
    if (!info.get().ativo()) {
      return problem(
          exchange,
          HttpStatus.FORBIDDEN,
          "tenant-suspenso",
          "Tenant suspenso",
          "O tenant '" + tenant + "' está suspenso.");
    }
    RateLimiter.Decision decision = limiter.tryAcquire(tenant, info.get().plano());
    rateLimitHeaders(exchange, decision);
    if (!decision.allowed()) {
      return tooManyRequests(
          exchange,
          decision,
          "O plano "
              + info.get().plano()
              + " permite "
              + decision.perSecond()
              + " requisições por segundo para o tenant '"
              + tenant
              + "'.");
    }
    return chain.filter(withIdentity(exchange, identity, tenant));
  }

  private static ServerWebExchange withIdentity(
      ServerWebExchange exchange, Identity identity, String tenant) {
    ServerHttpRequest request =
        exchange
            .getRequest()
            .mutate()
            .headers(
                h -> {
                  h.set(USUARIO, identity.usuario());
                  h.set(PAPEIS, String.join(",", identity.papeis()));
                  if (identity.clienteId() != null) {
                    h.set(CLIENTE, identity.clienteId());
                  }
                  if (tenant != null) {
                    h.set(TENANT, tenant);
                  }
                })
            .build();
    return exchange.mutate().request(request).build();
  }

  /** Escreve os cabeçalhos do limite e, se ele estourou, o 429. */
  private Mono<Void> tooManyRequests(
      ServerWebExchange exchange, RateLimiter.Decision decision, String detail) {
    var headers = exchange.getResponse().getHeaders();
    headers.set("Retry-After", String.valueOf(decision.retryAfterSeconds()));
    return problem(
        exchange,
        HttpStatus.TOO_MANY_REQUESTS,
        "limite-excedido",
        "Limite de requisições excedido",
        detail);
  }

  private void rateLimitHeaders(ServerWebExchange exchange, RateLimiter.Decision decision) {
    var headers = exchange.getResponse().getHeaders();
    headers.set("X-RateLimit-Limit", String.valueOf(decision.perSecond()));
    headers.set("X-RateLimit-Remaining", String.valueOf(decision.remaining()));
  }

  private Mono<Void> problem(
      ServerWebExchange exchange, HttpStatus status, String type, String title, String detail) {
    return Problems.write(exchange, json, Problems.of(status, type, title, detail));
  }

  private static String trimToNull(String s) {
    return s == null || s.isBlank() ? null : s.strip();
  }
}
