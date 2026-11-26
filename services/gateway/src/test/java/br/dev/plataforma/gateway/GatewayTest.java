package br.dev.plataforma.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.reactive.server.SecurityMockServerConfigurers.mockJwt;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.AutoConfigureWebTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.reactive.server.SecurityMockServerConfigurers.JwtMutator;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * Regras do gateway com tokens simulados ({@code mockJwt}) e um serviço falso atrás dele. A
 * validação de tokens reais do Keycloak fica no {@code GatewayKeycloakIT}.
 */
@SpringBootTest(
    properties = {
      "plataforma.gateway.tenants.events=false",
      "plataforma.gateway.jwk-set-uri=http://localhost:1/certs",
      "plataforma.gateway.issuer=http://localhost:1/realms/plataforma",
      "plataforma.gateway.limits.GRATUITO.per-second=1",
      "plataforma.gateway.limits.GRATUITO.burst=3",
      "plataforma.gateway.user-limit.per-second=1",
      "plataforma.gateway.user-limit.burst=20"
    })
@AutoConfigureWebTestClient
class GatewayTest {

  static final BackendStub BACKEND = new BackendStub();

  @DynamicPropertySource
  static void propriedades(DynamicPropertyRegistry registry) {
    registry.add("plataforma.gateway.services.tenants", BACKEND::url);
    registry.add("plataforma.gateway.services.status", BACKEND::url);
    registry.add("plataforma.gateway.services.catalogo", BACKEND::url);
    registry.add("plataforma.gateway.services.pedidos", BACKEND::url);
    registry.add("plataforma.gateway.services.pagamentos", BACKEND::url);
  }

  @AfterAll
  static void parar() {
    BACKEND.close();
  }

  @Autowired WebTestClient web;
  @Autowired TenantDirectory directory;

  @BeforeEach
  void catalogo() {
    directory.apply(
        new TenantInfo("acme", "ACME", Plano.PROFISSIONAL, NivelIsolamento.POOL, true, 0));
    directory.apply(
        new TenantInfo("globex", "Globex", Plano.GRATUITO, NivelIsolamento.POOL, true, 0));
    directory.apply(
        new TenantInfo("suspensa", "Suspensa", Plano.GRATUITO, NivelIsolamento.POOL, false, 0));
    directory.markLoaded();
  }

  static JwtMutator usuario(String nome, String papel, List<String> tenants, String clienteId) {
    return mockJwt()
        .jwt(
            j -> {
              j.claim("preferred_username", nome)
                  .claim("name", nome.toUpperCase())
                  .claim("realm_access", Map.of("roles", List.of(papel, "offline_access")))
                  // O Keycloak manda o caminho completo do grupo; grupos fora de /tenants/ não
                  // contam.
                  .claim(
                      "tenants",
                      java.util.stream.Stream.concat(
                              tenants.stream().map(t -> "/tenants/" + t),
                              java.util.stream.Stream.of("/departamentos/globex"))
                          .toList());
              if (clienteId != null) {
                j.claim("cliente_id", clienteId);
              }
            })
        .authorities(new SimpleGrantedAuthority("ROLE_" + papel));
  }

  static final JwtMutator BRUNO = usuario("bruno", "comprador", List.of("acme"), "cli-bruno");
  static final JwtMutator ANA = usuario("ana", "gestor-tenant", List.of("acme", "globex"), null);
  static final JwtMutator ADMIN = usuario("admin", "plataforma-admin", List.of(), null);

  @Test
  void metricasNaoSaemPelaPortaPublica() {
    // As métricas têm nomes de tenants: ficam na porta interna do actuator (8001), não na 8000.
    web.get().uri("/actuator/prometheus").exchange().expectStatus().is4xxClientError();
    web.get()
        .uri("/actuator/prometheus")
        .headers(h -> h.setBearerAuth("x"))
        .exchange()
        .expectStatus()
        .is4xxClientError();
  }

  @Test
  void statusEPublicoESemCabecalhosDeIdentidade() {
    web.get()
        .uri("/api/status")
        .header("X-Tenant-Id", "acme")
        .header("X-Papeis", "plataforma-admin")
        .exchange()
        .expectStatus()
        .isOk();
    assertThat(BACKEND.lastHeaders)
        .containsEntry("X-Tenant-Id", "<ausente>")
        .containsEntry("X-Papeis", "<ausente>");
  }

  @Test
  void semTokenDa401EmProblemDetails() {
    web.get()
        .uri("/api/v1/me")
        .exchange()
        .expectStatus()
        .isUnauthorized()
        .expectHeader()
        .contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON)
        .expectBody()
        .jsonPath("$.type")
        .isEqualTo("https://plataforma.dev.br/problemas/nao-autenticado");
  }

  @Test
  void meListaOsTenantsDoUsuarioComODadosDoCadastro() {
    web.mutateWith(ANA)
        .get()
        .uri("/api/v1/me")
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.usuario")
        .isEqualTo("ana")
        .jsonPath("$.papeis[0]")
        .isEqualTo("gestor-tenant")
        .jsonPath("$.papeis.length()")
        .isEqualTo(1)
        .jsonPath("$.tenants[*].id")
        .isEqualTo(List.of("acme", "globex"))
        .jsonPath("$.tenants[0].plano")
        .isEqualTo("PROFISSIONAL");
  }

  @Test
  void adminEnxergaTodosOsTenants() {
    web.mutateWith(ADMIN)
        .get()
        .uri("/api/v1/me")
        .exchange()
        .expectBody()
        .jsonPath("$.tenants.length()")
        .isEqualTo(3);
  }

  @Test
  void apiDeTenantsExigePlataformaAdmin() {
    web.mutateWith(ANA)
        .get()
        .uri("/api/v1/tenants")
        .exchange()
        .expectStatus()
        .isForbidden()
        .expectBody()
        .jsonPath("$.type")
        .isEqualTo("https://plataforma.dev.br/problemas/acesso-negado");

    web.mutateWith(ADMIN).get().uri("/api/v1/tenants").exchange().expectStatus().isOk();
    assertThat(BACKEND.lastHeaders)
        .containsEntry("X-Usuario", "admin")
        .containsEntry("X-Papeis", "plataforma-admin")
        .containsEntry("X-Tenant-Id", "<ausente>");
  }

  @Test
  void cabecalhosForjadosSaoDescartadosEOGatewayEscreveOsVerificados() {
    web.mutateWith(ADMIN)
        .get()
        .uri("/api/v1/tenants/acme")
        .header("X-Cliente-Id", "cli-forjado")
        .header("X-Usuario", "outra-pessoa")
        .exchange()
        .expectStatus()
        .isOk();
    assertThat(BACKEND.lastHeaders)
        .containsEntry("X-Usuario", "admin")
        .containsEntry("X-Cliente-Id", "<ausente>");
  }

  @Test
  void tenantDeOutroUsuarioDa403() {
    web.mutateWith(BRUNO)
        .get()
        .uri("/api/v1/me")
        .header("X-Tenant-Id", "globex")
        .exchange()
        .expectStatus()
        .isForbidden()
        .expectBody()
        .jsonPath("$.detail")
        .isEqualTo("O tenant 'globex' não pertence ao seu usuário.");
  }

  @Test
  void tenantSuspensoOuInexistenteDa403() {
    JwtMutator todos = usuario("x", "gestor-tenant", List.of("suspensa", "fantasma"), null);
    web.mutateWith(todos)
        .get()
        .uri("/api/v1/me")
        .header("X-Tenant-Id", "suspensa")
        .exchange()
        .expectStatus()
        .isForbidden()
        .expectBody()
        .jsonPath("$.type")
        .isEqualTo("https://plataforma.dev.br/problemas/tenant-suspenso");
    web.mutateWith(todos)
        .get()
        .uri("/api/v1/me")
        .header("X-Tenant-Id", "fantasma")
        .exchange()
        .expectStatus()
        .isForbidden();
  }

  @Test
  void limiteDoPlanoDa429ComRetryAfter() {
    // GRATUITO neste teste: 1 req/s, rajada de 3
    JwtMutator globex = usuario("g", "gestor-tenant", List.of("globex"), null);
    for (int i = 0; i < 3; i++) {
      web.mutateWith(globex)
          .get()
          .uri("/api/v1/me")
          .header("X-Tenant-Id", "globex")
          .exchange()
          .expectStatus()
          .isOk()
          .expectHeader()
          .valueEquals("X-RateLimit-Limit", "1");
    }
    web.mutateWith(globex)
        .get()
        .uri("/api/v1/me")
        .header("X-Tenant-Id", "globex")
        .exchange()
        .expectStatus()
        .isEqualTo(429)
        .expectHeader()
        .exists("Retry-After")
        .expectBody()
        .jsonPath("$.type")
        .isEqualTo("https://plataforma.dev.br/problemas/limite-excedido");
  }

  @Test
  void apiDeNegocioSemTenantEscolhidoDa400() {
    web.mutateWith(ANA)
        .get()
        .uri("/api/v1/produtos")
        .exchange()
        .expectStatus()
        .isBadRequest()
        .expectBody()
        .jsonPath("$.type")
        .isEqualTo("https://plataforma.dev.br/problemas/tenant-invalido");
  }

  @Test
  void caminhoForaDaApiENegado() {
    web.mutateWith(ADMIN).get().uri("/qualquer").exchange().expectStatus().isForbidden();
  }

  @Test
  void grupoForaDeTenantsNaoDaAcessoAoTenant() {
    // bruno está no grupo /departamentos/globex, que não é um tenant
    web.mutateWith(BRUNO)
        .get()
        .uri("/api/v1/me")
        .header("X-Tenant-Id", "globex")
        .exchange()
        .expectStatus()
        .isForbidden();
  }

  @Test
  void semTenantOLimiteEPorUsuario() {
    // user-limit neste teste: 1 req/s, rajada de 20; /me e /tenants sem tenant usam o balde do
    // usuário
    JwtMutator admin2 = usuario("admin2", "plataforma-admin", List.of(), null);
    web.mutateWith(admin2).get().uri("/api/v1/me").exchange().expectStatus().isOk();
    int status = 200;
    for (int i = 0; i < 40 && status != 429; i++) {
      status =
          web.mutateWith(admin2)
              .get()
              .uri("/api/v1/tenants")
              .exchange()
              .returnResult(String.class)
              .getStatus()
              .value();
    }
    assertThat(status).isEqualTo(429);
    // outro usuário tem o próprio balde
    web.mutateWith(ADMIN).get().uri("/api/v1/tenants").exchange().expectStatus().isOk();
  }

  @Test
  void meSemCabecalhoRespondeMesmoComOUnicoTenantSuspenso() {
    JwtMutator suspenso = usuario("sus", "gestor-tenant", List.of("suspensa"), null);
    web.mutateWith(suspenso)
        .get()
        .uri("/api/v1/me")
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.tenants[0].ativo")
        .isEqualTo(false);
  }

  @Test
  void tenantForaDoFormatoDa400() {
    web.mutateWith(ADMIN)
        .get()
        .uri("/api/v1/me")
        .header("X-Tenant-Id", "ACME!")
        .exchange()
        .expectStatus()
        .isBadRequest()
        .expectBody()
        .jsonPath("$.type")
        .isEqualTo("https://plataforma.dev.br/problemas/tenant-invalido");
  }

  @Test
  void rotaInexistenteDa404EmProblemDetails() {
    web.mutateWith(ADMIN)
        .get()
        .uri("/api/v1/nada")
        .header("X-Tenant-Id", "acme")
        .exchange()
        .expectStatus()
        .isNotFound()
        .expectHeader()
        .contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON)
        .expectBody()
        .jsonPath("$.type")
        .isEqualTo("https://plataforma.dev.br/problemas/nao-encontrado");
  }

  @Test
  void corsValeTambemParaErrosDoGateway() {
    web.get()
        .uri("http://gateway.local/api/v1/me")
        .header("Origin", "http://localhost:5173")
        .exchange()
        .expectStatus()
        .isUnauthorized()
        .expectHeader()
        .valueEquals("Access-Control-Allow-Origin", "http://localhost:5173");
    web.options()
        .uri("http://gateway.local/api/v1/me")
        .header("Origin", "http://localhost:5173")
        .header("Access-Control-Request-Method", "GET")
        .header("Access-Control-Request-Headers", "authorization,x-tenant-id")
        .exchange()
        .expectStatus()
        .isOk()
        .expectHeader()
        .valueEquals("Access-Control-Allow-Origin", "http://localhost:5173");
  }

  @Test
  void produtosVaoParaOCatalogoComTenantEPapeis() {
    web.mutateWith(ANA)
        .get()
        .uri("/api/v1/produtos?busca=cafe")
        .header("X-Tenant-Id", "acme")
        .exchange()
        .expectStatus()
        .isOk();
    assertThat(BACKEND.lastHeaders)
        .containsEntry("path", "/api/v1/produtos?busca=cafe")
        .containsEntry("X-Tenant-Id", "acme")
        .containsEntry("X-Papeis", "gestor-tenant")
        .containsEntry("X-Usuario", "ana");
  }

  @Test
  void pedidosVaoParaOPedidosServiceComOClienteDoToken() {
    web.mutateWith(BRUNO)
        .post()
        .uri("/api/v1/pedidos")
        .header("X-Tenant-Id", "acme")
        .header("Idempotency-Key", "chave-de-teste-1")
        // Cliente forjado pelo navegador é descartado: vale o do token.
        .header("X-Cliente-Id", "cli-outro")
        .exchange()
        .expectStatus()
        .isOk();
    assertThat(BACKEND.lastHeaders)
        .containsEntry("path", "/api/v1/pedidos")
        .containsEntry("X-Tenant-Id", "acme")
        .containsEntry("X-Cliente-Id", "cli-bruno")
        .containsEntry("Idempotency-Key", "chave-de-teste-1")
        .containsEntry("X-Papeis", "comprador");
  }

  @Test
  void pagamentosELedgerVaoParaOPagamentosService() {
    for (String uri :
        new String[] {"/api/v1/pagamentos?status=APROVADO", "/api/v1/ledger/lancamentos"}) {
      web.mutateWith(ANA)
          .get()
          .uri(uri)
          .header("X-Tenant-Id", "acme")
          .exchange()
          .expectStatus()
          .isOk();
      assertThat(BACKEND.lastHeaders)
          .containsEntry("path", uri)
          .containsEntry("X-Tenant-Id", "acme")
          .containsEntry("X-Papeis", "gestor-tenant");
    }
  }

  @Test
  void isolamentoDosPedidosVaiParaOPedidosService() {
    web.mutateWith(ANA)
        .get()
        .uri("/api/v1/isolamento/pedidos")
        .header("X-Tenant-Id", "acme")
        .exchange()
        .expectStatus()
        .isOk();
    assertThat(BACKEND.lastHeaders)
        .containsEntry("path", "/api/v1/isolamento/pedidos")
        .containsEntry("X-Tenant-Id", "acme");
  }
}
