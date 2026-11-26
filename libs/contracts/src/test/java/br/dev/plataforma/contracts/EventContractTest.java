package br.dev.plataforma.contracts;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.apache.avro.Schema;
import org.junit.jupiter.api.Test;

class EventContractTest {

  private static Schema parse(String props) {
    return new Schema.Parser()
        .parse(
            "{\"type\":\"record\",\"name\":\"X\",\"namespace\":\"t\"," + props + "\"fields\":[]}");
  }

  @Test
  void leContratoCompleto() {
    var c =
        EventContract.from(
            parse(
                "\"x-evento\":\"a.b\",\"x-topico\":\"persistent://p/a/a.b.v1\","
                    + "\"x-produtor\":\"a\",\"x-consumidores\":[\"b\"],"));
    assertThat(c.event()).isEqualTo("a.b");
    assertThat(c.consumers()).containsExactly("b");
  }

  @Test
  void semConsumidoresViraListaVazia() {
    var c =
        EventContract.from(parse("\"x-evento\":\"a.b\",\"x-topico\":\"t\",\"x-produtor\":\"a\","));
    assertThat(c.consumers()).isEmpty();
  }

  @Test
  void propriedadeObrigatoriaAusenteOuVaziaFalha() {
    assertThatThrownBy(() -> EventContract.from(parse("\"x-topico\":\"t\",\"x-produtor\":\"a\",")))
        .hasMessageContaining("x-evento");
    assertThatThrownBy(
            () ->
                EventContract.from(
                    parse("\"x-evento\":\" \",\"x-topico\":\"t\",\"x-produtor\":\"a\",")))
        .hasMessageContaining("x-evento");
  }

  @Test
  void consumidoresQueNaoSaoListaFalham() {
    assertThatThrownBy(
            () ->
                EventContract.from(
                    parse(
                        "\"x-evento\":\"a.b\",\"x-topico\":\"t\",\"x-produtor\":\"a\","
                            + "\"x-consumidores\":\"b\",")))
        .hasMessageContaining("lista");
  }

  @Test
  void consumidoresNulosNoConstrutorViramListaVazia() {
    var c = new EventContract("a.b", "t", "a", null, parse(""));
    assertThat(c.consumers()).isEmpty();
  }
}
