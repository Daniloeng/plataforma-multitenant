package br.dev.plataforma.status;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(StatusController.class)
class StatusControllerTest {

  @Autowired private MockMvc mvc;

  @MockitoBean private StatusService statusService;

  @Test
  void devolveContratoEsperadoPeloFrontend() throws Exception {
    when(statusService.current())
        .thenReturn(
            new PlatformStatus(
                HealthState.DEGRADED,
                Instant.parse("2026-11-26T12:00:00Z"),
                "0.1.0",
                List.of(
                    ComponentStatus.up(
                        "mongo-tenants", ComponentType.MONGODB, 3, "replica set rs0"),
                    ComponentStatus.down("pulsar", ComponentType.PULSAR, 2000, "HTTP 503"))));

    mvc.perform(get("/api/status"))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.status").value("DEGRADED"))
        .andExpect(jsonPath("$.checkedAt").value("2026-11-26T12:00:00Z"))
        .andExpect(jsonPath("$.version").value("0.1.0"))
        .andExpect(jsonPath("$.components[0].name").value("mongo-tenants"))
        .andExpect(jsonPath("$.components[0].type").value("MONGODB"))
        .andExpect(jsonPath("$.components[0].status").value("UP"))
        .andExpect(jsonPath("$.components[0].latencyMs").value(3))
        .andExpect(jsonPath("$.components[0].details").value("replica set rs0"))
        .andExpect(jsonPath("$.components[1].status").value("DOWN"));
  }
}
