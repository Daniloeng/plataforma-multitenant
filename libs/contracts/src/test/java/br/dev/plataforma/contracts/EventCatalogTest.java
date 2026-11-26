package br.dev.plataforma.contracts;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import br.dev.plataforma.contracts.pedidos.PedidoCriado;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.apache.avro.Schema;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Regras que todo evento da plataforma precisa seguir (ver ADR-0004). */
class EventCatalogTest {

  private static final Set<String> SERVICOS =
      Set.of("tenants", "catalogo", "pedidos", "pagamentos");

  /** O gateway consome eventos (catálogo de tenants em cache), mas nunca publica. */
  private static final Set<String> CONSUMIDORES =
      Set.of("tenants", "catalogo", "pedidos", "pagamentos", "gateway");

  private static final Pattern TOPICO =
      Pattern.compile("^persistent://plataforma/([a-z]+)/([a-z]+\\.[a-z]+)\\.v(\\d+)$");

  static List<EventContract> eventos() {
    return EventCatalog.defaultCatalog().all();
  }

  @Test
  void catalogoTemOsDezEventosDoPlano() {
    assertThat(eventos())
        .extracting(EventContract::event)
        .containsExactly(
            "tenant.criado",
            "tenant.alterado",
            "produto.alterado",
            "preco.alterado",
            "pedido.criado",
            "pedido.confirmado",
            "pedido.cancelado",
            "pagamento.aprovado",
            "pagamento.recusado",
            "pagamento.estornado");
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("eventos")
  void todoEventoTemOsMetadadosObrigatorios(EventContract contrato) {
    Schema schema = contrato.schema();
    assertThat(schema.getField("eventId").schema().getLogicalType().getName()).isEqualTo("uuid");
    assertThat(schema.getField("tenantId").schema().getType()).isEqualTo(Schema.Type.STRING);
    assertThat(schema.getField("occurredAt").schema().getLogicalType().getName())
        .isEqualTo("timestamp-millis");
    Schema traceparent = schema.getField("traceparent").schema();
    assertThat(traceparent.isNullable()).isTrue();
    assertThat(schema.getField("traceparent").hasDefaultValue()).isTrue();
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("eventos")
  void topicoSegueOPadraoEBateComEventoEProdutor(EventContract contrato) {
    var m = TOPICO.matcher(contrato.topic());
    assertThat(m.matches()).as(contrato.topic()).isTrue();
    assertThat(m.group(1)).isEqualTo(contrato.producer());
    assertThat(m.group(2)).isEqualTo(contrato.event());
    assertThat(contrato.schema().getNamespace())
        .isEqualTo("br.dev.plataforma.contracts." + contrato.producer());
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("eventos")
  void produtorEConsumidoresSaoServicosConhecidosENinguemConsomeOProprioEvento(
      EventContract contrato) {
    assertThat(SERVICOS).contains(contrato.producer());
    assertThat(contrato.consumers()).allSatisfy(c -> assertThat(CONSUMIDORES).contains(c));
    assertThat(contrato.consumers()).doesNotContain(contrato.producer());
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("eventos")
  void todoEventoTemDescricao(EventContract contrato) {
    assertThat(contrato.schema().getDoc()).isNotBlank();
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("eventos")
  void enumsTemDefaultParaConsumidoresAntigos(EventContract contrato) {
    contrato.schema().getFields().stream()
        .map(f -> f.schema())
        .filter(s -> s.getType() == Schema.Type.ENUM)
        .forEach(s -> assertThat(s.getEnumDefault()).as(s.getFullName()).isNotNull());
  }

  @Test
  void consultasPorEventoClasseEServico() {
    EventCatalog catalogo = EventCatalog.defaultCatalog();

    assertThat(catalogo.byEvent("pedido.criado"))
        .get()
        .extracting(EventContract::producer)
        .isEqualTo("pedidos");
    assertThat(catalogo.byEvent("pedido.inexistente")).isEmpty();
    assertThat(catalogo.of(PedidoCriado.class).topic())
        .isEqualTo("persistent://plataforma/pedidos/pedido.criado.v1");
    assertThat(catalogo.producedBy("pagamentos")).hasSize(3);
    assertThat(catalogo.consumedBy("pedidos"))
        .extracting(EventContract::event)
        .containsExactlyInAnyOrder(
            "tenant.criado",
            "tenant.alterado",
            "produto.alterado",
            "preco.alterado",
            "pagamento.aprovado",
            "pagamento.recusado");
    assertThat(catalogo.consumedBy("pagamentos"))
        .extracting(EventContract::event)
        .containsExactlyInAnyOrder(
            "tenant.criado", "tenant.alterado", "pedido.criado", "pedido.cancelado");
  }

  @Test
  void classeSemContratoFalha() {
    assertThatThrownBy(
            () ->
                EventCatalog.defaultCatalog()
                    .of(br.dev.plataforma.contracts.pedidos.ItemPedido.class))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("ItemPedido");
  }

  @Test
  void eventoDuplicadoNoCatalogoFalha() {
    Schema schema = PedidoCriado.getClassSchema();
    assertThatThrownBy(() -> new EventCatalog(List.of(schema, schema)))
        .hasMessageContaining("duplicado");
  }
}
