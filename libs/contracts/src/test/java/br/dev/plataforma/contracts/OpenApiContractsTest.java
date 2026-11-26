package br.dev.plataforma.contracts;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.parser.OpenAPIV3Parser;
import io.swagger.v3.parser.core.models.ParseOptions;
import io.swagger.v3.parser.core.models.SwaggerParseResult;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** Regras das APIs REST (ver ADR-0004): válidas, versionadas e com tenant no cabeçalho. */
class OpenApiContractsTest {

  private static final String DIR = "src/main/resources/openapi/";

  private static OpenAPI parse(String arquivo) {
    ParseOptions options = new ParseOptions();
    options.setResolve(true);
    SwaggerParseResult result = new OpenAPIV3Parser().readLocation(DIR + arquivo, null, options);
    assertThat(result.getMessages()).as("erros de parse em " + arquivo).isEmpty();
    assertThat(result.getOpenAPI()).isNotNull();
    return result.getOpenAPI();
  }

  private static List<Operation> operacoes(OpenAPI api) {
    List<Operation> ops = new ArrayList<>();
    api.getPaths().values().forEach(p -> ops.addAll(p.readOperations()));
    return ops;
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "tenants.yaml",
        "catalogo.yaml",
        "pedidos.yaml",
        "pagamentos.yaml",
        "gateway.yaml"
      })
  void apiValidaVersionadaEComOperationIdUnico(String arquivo) {
    OpenAPI api = parse(arquivo);

    assertThat(api.getOpenapi()).startsWith("3.1");
    assertThat(api.getPaths().keySet()).allSatisfy(p -> assertThat(p).startsWith("/api/v1/"));
    Set<String> ids = new HashSet<>();
    for (Operation op : operacoes(api)) {
      assertThat(op.getOperationId()).isNotBlank();
      assertThat(ids.add(op.getOperationId())).as(op.getOperationId()).isTrue();
      assertThat(op.getResponses()).isNotEmpty();
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"catalogo.yaml", "pedidos.yaml", "pagamentos.yaml"})
  void apisDeNegocioExigemXTenantIdEmTodaOperacao(String arquivo) {
    OpenAPI api = parse(arquivo);

    for (Map.Entry<String, PathItem> e : api.getPaths().entrySet()) {
      PathItem item = e.getValue();
      for (Operation op : item.readOperations()) {
        List<Parameter> params =
            Stream.concat(
                    item.getParameters() == null ? Stream.empty() : item.getParameters().stream(),
                    op.getParameters() == null ? Stream.empty() : op.getParameters().stream())
                .toList();
        assertThat(params)
            .as("X-Tenant-Id em %s %s", op.getOperationId(), e.getKey())
            .anySatisfy(
                p -> {
                  assertThat(p.getName()).isEqualTo("X-Tenant-Id");
                  assertThat(p.getIn()).isEqualTo("header");
                  assertThat(p.getRequired()).isTrue();
                });
      }
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"catalogo.yaml", "pedidos.yaml", "pagamentos.yaml"})
  void nenhumCorpoDeRequisicaoAceitaTenantOuCliente(String arquivo) {
    OpenAPI api = parse(arquivo);

    for (Operation op : operacoes(api)) {
      if (op.getRequestBody() == null) {
        continue;
      }
      for (MediaType media : op.getRequestBody().getContent().values()) {
        Set<String> campos = new HashSet<>();
        coletarPropriedades(api, media.getSchema(), campos, new HashSet<>());
        assertThat(campos)
            .as("corpo de %s", op.getOperationId())
            .doesNotContain("tenantId", "tenant", "clienteId");
      }
    }
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "tenants.yaml",
        "catalogo.yaml",
        "pedidos.yaml",
        "pagamentos.yaml",
        "gateway.yaml"
      })
  void todaApiExigeJwtEDescreveAutorizacao(String arquivo) {
    OpenAPI api = parse(arquivo);

    assertThat(api.getSecurity()).isNotEmpty();
    assertThat(api.getSecurity().getFirst()).containsKey("jwt");
    assertThat(api.getExtensions()).containsKey("x-autorizacao");
  }

  @org.junit.jupiter.api.Test
  @SuppressWarnings("rawtypes")
  void statusEPublicoEMetricasSaoOpcionais() {
    OpenAPI api = parse("status.yaml");

    assertThat(api.getOpenapi()).startsWith("3.1");
    assertThat(api.getPaths()).containsOnlyKeys("/api/status");
    assertThat(api.getSecurity()).isNullOrEmpty();
    Map<String, Schema> schemas = api.getComponents().getSchemas();
    assertThat(schemas.get("ComponentStatus").getRequired()).doesNotContain("metrics", "details");
    Schema metricas = schemas.get("ServiceMetrics");
    assertThat(metricas.getRequired()).containsExactlyInAnyOrder("requests", "errorRate");
    assertThat(metricas.getProperties())
        .containsOnlyKeys(
            "requests",
            "errorRate",
            "p99Ms",
            "outboxPending",
            "outboxLagSeconds",
            "eventsConsumed",
            "eventsFailed",
            "outboxUnreadable");
  }

  /** Junta os nomes de propriedades de um schema, seguindo $ref e schemas aninhados. */
  @SuppressWarnings("rawtypes")
  private static void coletarPropriedades(
      OpenAPI api, Schema schema, Set<String> campos, Set<String> visitados) {
    if (schema == null) {
      return;
    }
    if (schema.get$ref() != null) {
      String nome = schema.get$ref().substring(schema.get$ref().lastIndexOf('/') + 1);
      if (visitados.add(nome)) {
        coletarPropriedades(api, api.getComponents().getSchemas().get(nome), campos, visitados);
      }
      return;
    }
    if (schema.getProperties() != null) {
      Map<String, Schema> props = schema.getProperties();
      campos.addAll(props.keySet());
      props.values().forEach(p -> coletarPropriedades(api, p, campos, visitados));
    }
    coletarPropriedades(api, schema.getItems(), campos, visitados);
  }

  @ParameterizedTest
  @ValueSource(strings = {"pedidos.yaml"})
  void criacaoDePedidoExigeChaveDeIdempotenciaEClienteDoToken(String arquivo) {
    Operation criar = parse(arquivo).getPaths().get("/api/v1/pedidos").getPost();
    assertThat(criar.getParameters())
        .extracting(Parameter::getName)
        .contains("Idempotency-Key", "X-Cliente-Id");
  }

  @ParameterizedTest
  @ValueSource(strings = {"pedidos.yaml"})
  void todaOperacaoDePedidosRecebeOClienteParaChecarDono(String arquivo) {
    OpenAPI api = parse(arquivo);
    for (Operation op : operacoes(api)) {
      assertThat(op.getParameters())
          .as(op.getOperationId())
          .extracting(Parameter::getName)
          .contains("X-Cliente-Id");
    }
  }
}
