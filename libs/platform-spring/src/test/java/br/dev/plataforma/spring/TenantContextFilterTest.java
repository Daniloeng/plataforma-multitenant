package br.dev.plataforma.spring;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import br.dev.plataforma.spring.tenancy.TenantContext;
import br.dev.plataforma.spring.tenancy.TenantContextFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

class TenantContextFilterTest {

  @RestController
  static class Eco {
    @GetMapping({"/api/v1/eco", "/api/v1/admin/eco", "/actuator/eco"})
    String eco() {
      return TenantContext.current().map(Object::toString).orElse("-")
          + "|"
          + TenantContext.clienteId().orElse("-")
          + "|"
          + MDC.get("tenantId");
    }
  }

  private MockMvc mvc;

  @BeforeEach
  void setUp() {
    mvc =
        MockMvcBuilders.standaloneSetup(new Eco())
            .addFilters(
                new TenantContextFilter(
                    List.of("/api/v1/**"), List.of("/api/v1/admin/**"), new ObjectMapper()))
            .build();
  }

  @Test
  void preencheTenantClienteEMdc() throws Exception {
    mvc.perform(get("/api/v1/eco").header("X-Tenant-Id", " acme ").header("X-Cliente-Id", "c1"))
        .andExpect(status().isOk())
        .andExpect(content().string("acme|c1|acme"));
  }

  @Test
  void clienteEmBrancoViraAusente() throws Exception {
    mvc.perform(get("/api/v1/eco").header("X-Tenant-Id", "acme").header("X-Cliente-Id", "  "))
        .andExpect(content().string("acme|-|acme"));
  }

  @Test
  void semCabecalhoResponde400EmProblemDetails() throws Exception {
    mvc.perform(get("/api/v1/eco"))
        .andExpect(status().isBadRequest())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.title").value("Tenant inválido"))
        .andExpect(jsonPath("$.detail").value("Cabeçalho X-Tenant-Id ausente."))
        .andExpect(jsonPath("$.instance").value("/api/v1/eco"));
  }

  @Test
  void caminhoCodificadoNaoEscapaDaRegra() throws Exception {
    // %31 é "1": o Spring MVC roteia para /api/v1/eco, então o filtro também precisa exigir tenant.
    mvc.perform(get(java.net.URI.create("/api/v%31/eco"))).andExpect(status().isBadRequest());
  }

  @Test
  void tenantInvalidoResponde400ComMotivo() throws Exception {
    mvc.perform(get("/api/v1/eco").header("X-Tenant-Id", "ACME!"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("inválido")));
  }

  @Test
  void caminhosExcluidosOuForaDaRegraNaoExigemTenant() throws Exception {
    mvc.perform(get("/api/v1/admin/eco")).andExpect(content().string("-|-|null"));
    mvc.perform(get("/actuator/eco")).andExpect(content().string("-|-|null"));
  }
}
