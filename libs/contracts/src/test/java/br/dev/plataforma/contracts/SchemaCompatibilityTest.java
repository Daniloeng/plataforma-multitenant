package br.dev.plataforma.contracts;

import static org.assertj.core.api.Assertions.assertThat;

import org.apache.avro.Schema;
import org.junit.jupiter.api.Test;

/** Exemplos do que a regra de compatibilidade permite e proíbe (ver ADR-0004). */
class SchemaCompatibilityTest {

  private static final String V1 =
      "{\"type\":\"record\",\"name\":\"E\",\"fields\":[{\"name\":\"a\",\"type\":\"string\"}]}";

  private static Schema s(String json) {
    return new Schema.Parser().parse(json);
  }

  @Test
  void mesmoSchemaEhCompativel() {
    assertThat(SchemaCompatibility.backwardIssues(s(V1), s(V1))).isEmpty();
  }

  @Test
  void novoCampoComDefaultEhCompativel() {
    String v2 =
        "{\"type\":\"record\",\"name\":\"E\",\"fields\":[{\"name\":\"a\",\"type\":\"string\"},"
            + "{\"name\":\"b\",\"type\":[\"null\",\"string\"],\"default\":null}]}";
    assertThat(SchemaCompatibility.backwardIssues(s(v2), s(V1))).isEmpty();
  }

  @Test
  void removerCampoEhCompativelParaQuemLe() {
    String v2 = "{\"type\":\"record\",\"name\":\"E\",\"fields\":[]}";
    assertThat(SchemaCompatibility.backwardIssues(s(v2), s(V1))).isEmpty();
  }

  @Test
  void novoCampoObrigatorioSemDefaultQuebra() {
    String v2 =
        "{\"type\":\"record\",\"name\":\"E\",\"fields\":[{\"name\":\"a\",\"type\":\"string\"},"
            + "{\"name\":\"b\",\"type\":\"string\"}]}";
    assertThat(SchemaCompatibility.backwardIssues(s(v2), s(V1)))
        .singleElement()
        .asString()
        .contains("READER_FIELD_MISSING_DEFAULT_VALUE");
  }

  @Test
  void trocarTipoQuebra() {
    String v2 =
        "{\"type\":\"record\",\"name\":\"E\",\"fields\":[{\"name\":\"a\",\"type\":\"int\"}]}";
    assertThat(SchemaCompatibility.backwardIssues(s(v2), s(V1))).isNotEmpty();
  }

  @Test
  void fullAceitaCampoOpcionalComDefault() {
    String v2 =
        "{\"type\":\"record\",\"name\":\"E\",\"fields\":[{\"name\":\"a\",\"type\":\"string\"},"
            + "{\"name\":\"b\",\"type\":[\"null\",\"string\"],\"default\":null}]}";
    assertThat(SchemaCompatibility.fullIssues(s(v2), s(V1))).isEmpty();
  }

  @Test
  void fullRecusaRemoverCampoSemDefault() {
    // Consumidor antigo ainda espera "a" e não tem default para ele.
    String v2 = "{\"type\":\"record\",\"name\":\"E\",\"fields\":[]}";
    assertThat(SchemaCompatibility.fullIssues(s(v2), s(V1)))
        .singleElement()
        .asString()
        .startsWith("FORWARD:");
  }

  @Test
  void fullAceitaNovoSimboloDeEnumQuandoHaDefault() {
    String v1 =
        "{\"type\":\"enum\",\"name\":\"M\",\"symbols\":[\"A\",\"OUTRO\"],\"default\":\"OUTRO\"}";
    String v2 =
        "{\"type\":\"enum\",\"name\":\"M\",\"symbols\":[\"A\",\"B\",\"OUTRO\"],\"default\":\"OUTRO\"}";
    assertThat(SchemaCompatibility.fullIssues(s(v2), s(v1))).isEmpty();
  }

  @Test
  void novoSimboloDeEnumSemDefaultQuebraConsumidorAntigo() {
    String v1 = "{\"type\":\"enum\",\"name\":\"M\",\"symbols\":[\"A\"]}";
    String v2 = "{\"type\":\"enum\",\"name\":\"M\",\"symbols\":[\"A\",\"B\"]}";
    assertThat(SchemaCompatibility.fullIssues(s(v2), s(v1)))
        .anyMatch(i -> i.startsWith("FORWARD:"));
  }
}
