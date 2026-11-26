package br.dev.plataforma.status;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.io.FileReader;
import java.io.Reader;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

/** O JSON do /api/status segue o status.yaml dos contratos (contract-first, ADR-0004). */
class ContratoStatusTest {

  private static final String CONTRATO =
      "../../libs/contracts/src/main/resources/openapi/status.yaml";

  @SuppressWarnings("unchecked")
  private static Set<String> propriedades(String schema) throws Exception {
    try (Reader r = new FileReader(CONTRATO)) {
      Map<String, Object> doc = new Yaml().load(r);
      var schemas =
          (Map<String, Object>) ((Map<String, Object>) doc.get("components")).get("schemas");
      return ((Map<String, Object>) ((Map<String, Object>) schemas.get(schema)).get("properties"))
          .keySet();
    }
  }

  private static Set<String> campos(JsonNode node) {
    Set<String> nomes = new HashSet<>();
    node.fieldNames().forEachRemaining(nomes::add);
    return nomes;
  }

  @Test
  void respostaTemExatamenteOsCamposDoContrato() throws Exception {
    var metricas = new ServiceMetrics(10, 0.1, 120.0, 0L, 0.0, 5L, 0L, false);
    var status =
        new PlatformStatus(
            HealthState.UP,
            Instant.parse("2026-11-26T10:00:00Z"),
            "dev",
            List.of(
                ComponentStatus.up("pedidos-service", ComponentType.SERVICE, 3, "ok")
                    .withMetrics(metricas)),
            new RuntimeInfo("kubernetes", "plataforma", "status-service-7d9f-abc"));
    JsonNode json = new ObjectMapper().registerModule(new JavaTimeModule()).valueToTree(status);

    assertThat(campos(json)).isEqualTo(propriedades("PlatformStatus"));
    assertThat(campos(json.get("components").get(0))).isEqualTo(propriedades("ComponentStatus"));
    assertThat(campos(json.get("components").get(0).get("metrics")))
        .isEqualTo(propriedades("ServiceMetrics"));
    assertThat(campos(json.get("runtime"))).isEqualTo(propriedades("RuntimeInfo"));
  }
}
