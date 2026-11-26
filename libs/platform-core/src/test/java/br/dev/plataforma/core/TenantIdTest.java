package br.dev.plataforma.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class TenantIdTest {

  @ParameterizedTest
  @ValueSource(strings = {"acme", "abc", "loja-01", "a1b", "distribuidora-norte-sul"})
  void aceitaSlugsValidos(String valor) {
    assertThat(new TenantId(valor).value()).isEqualTo(valor);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"", "ab", "Acme", "1acme", "acme-", "-acme", "ac me", "acme_01", "acme--01"})
  void rejeitaFormatosInvalidos(String valor) {
    assertThatThrownBy(() -> new TenantId(valor))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("tenantId inválido");
  }

  @Test
  void rejeitaMaisDeQuarentaCaracteres() {
    assertThatThrownBy(() -> new TenantId("a".repeat(41)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(new TenantId("a".repeat(40)).value()).hasSize(40);
  }

  @Test
  void rejeitaNulo() {
    assertThatThrownBy(() -> new TenantId(null)).isInstanceOf(NullPointerException.class);
    assertThatThrownBy(() -> TenantId.of(null)).isInstanceOf(NullPointerException.class);
  }

  @Test
  void ofNormalizaEspacosECaixa() {
    assertThat(TenantId.of("  ACME-Brasil ")).isEqualTo(new TenantId("acme-brasil"));
  }

  @Test
  void geraNamespacePulsarDedicado() {
    assertThat(new TenantId("acme").pulsarNamespace()).isEqualTo("plataforma/t-acme");
  }

  @Test
  void toStringDevolveOValor() {
    assertThat(new TenantId("acme")).hasToString("acme");
  }
}
