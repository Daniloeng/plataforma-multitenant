package br.dev.plataforma.gateway;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Collection;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.resource.authentication.ReactiveJwtAuthenticationConverterAdapter;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsConfigurationSource;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;
import reactor.core.publisher.Mono;

/**
 * Autenticação por JWT do Keycloak e autorização por papel. As APIs de negócio exigem token; a API
 * de tenants (plano administrativo, ADR-0005) exige o papel {@code plataforma-admin}; a página de
 * status e as probes ficam públicas.
 */
@Configuration
@EnableWebFluxSecurity
public class SecurityConfig {

  @Bean
  CorsConfigurationSource corsConfigurationSource(
      @Value("${plataforma.gateway.cors-origins:http://localhost:5173,http://localhost:4173}")
          String origins) {
    CorsConfiguration cors = new CorsConfiguration();
    cors.setAllowedOrigins(
        java.util.Arrays.stream(origins.split(","))
            .map(String::strip)
            .filter(o -> !o.isEmpty())
            .toList());
    cors.setAllowedMethods(List.of("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"));
    cors.setAllowedHeaders(List.of("*"));
    cors.setExposedHeaders(
        List.of("Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "Location"));
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", cors);
    return source;
  }

  @Bean
  SecurityWebFilterChain security(ServerHttpSecurity http, ObjectMapper json) {
    return http.csrf(ServerHttpSecurity.CsrfSpec::disable)
        // CORS na cadeia de segurança: vale também para 401/403/429 e para /api/v1/me, que não
        // passam pelas rotas do gateway (o globalcors só cobre respostas roteadas).
        .cors(Customizer.withDefaults())
        .httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
        .formLogin(ServerHttpSecurity.FormLoginSpec::disable)
        .logout(ServerHttpSecurity.LogoutSpec::disable)
        .authorizeExchange(
            auth ->
                auth.pathMatchers(HttpMethod.OPTIONS)
                    .permitAll()
                    .pathMatchers("/api/status", "/actuator/health/**", "/actuator/info")
                    .permitAll()
                    .pathMatchers("/api/v1/tenants", "/api/v1/tenants/**")
                    .hasRole(Identity.ADMIN)
                    .pathMatchers("/api/**")
                    .authenticated()
                    .anyExchange()
                    .denyAll())
        .oauth2ResourceServer(
            oauth ->
                oauth
                    .jwt(jwt -> jwt.jwtAuthenticationConverter(authenticationConverter()))
                    .authenticationEntryPoint(
                        (exchange, e) ->
                            Problems.write(
                                exchange,
                                json,
                                Problems.of(
                                    HttpStatus.UNAUTHORIZED,
                                    "nao-autenticado",
                                    "Não autenticado",
                                    "Envie um token válido do Keycloak no cabeçalho Authorization.")))
                    .accessDeniedHandler(
                        (exchange, e) ->
                            Problems.write(
                                exchange,
                                json,
                                Problems.of(
                                    HttpStatus.FORBIDDEN,
                                    "acesso-negado",
                                    "Acesso negado",
                                    "O seu papel não permite esta operação."))))
        .exceptionHandling(
            ex ->
                ex.authenticationEntryPoint(
                        (exchange, e) ->
                            Problems.write(
                                exchange,
                                json,
                                Problems.of(
                                    HttpStatus.UNAUTHORIZED,
                                    "nao-autenticado",
                                    "Não autenticado",
                                    "Envie um token válido do Keycloak no cabeçalho Authorization.")))
                    .accessDeniedHandler(
                        (exchange, e) ->
                            Problems.write(
                                exchange,
                                json,
                                Problems.of(
                                    HttpStatus.FORBIDDEN,
                                    "acesso-negado",
                                    "Acesso negado",
                                    "O seu papel não permite esta operação."))))
        .build();
  }

  /**
   * As chaves vêm do endereço interno do Keycloak, mas o emissor esperado é o público (o que o
   * navegador usou para obter o token). Também exige a audiência do gateway.
   */
  @Bean
  ReactiveJwtDecoder jwtDecoder(GatewayProperties props) {
    NimbusReactiveJwtDecoder decoder =
        NimbusReactiveJwtDecoder.withJwkSetUri(props.jwkSetUri()).build();
    OAuth2TokenValidator<Jwt> audience =
        jwt ->
            jwt.getAudience() != null && jwt.getAudience().contains(props.audience())
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(
                    new OAuth2Error("invalid_token", "Audiência inválida", null));
    decoder.setJwtValidator(
        new DelegatingOAuth2TokenValidator<>(
            JwtValidators.createDefaultWithIssuer(props.issuer()), audience));
    return decoder;
  }

  static Converter<Jwt, Mono<AbstractAuthenticationToken>> authenticationConverter() {
    Converter<Jwt, AbstractAuthenticationToken> converter =
        jwt -> new JwtAuthenticationToken(jwt, authorities(jwt), Identity.from(jwt).usuario());
    return new ReactiveJwtAuthenticationConverterAdapter(converter);
  }

  static Collection<GrantedAuthority> authorities(Jwt jwt) {
    List<GrantedAuthority> list =
        Identity.roles(jwt).stream()
            .map(r -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + r))
            .toList();
    return list;
  }
}
