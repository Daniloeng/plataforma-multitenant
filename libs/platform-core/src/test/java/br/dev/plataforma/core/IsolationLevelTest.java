package br.dev.plataforma.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

class IsolationLevelTest {

  @Test
  void poolCompartilhaTudo() {
    assertThat(IsolationLevel.POOL.hasDedicatedNamespace()).isFalse();
    assertThat(IsolationLevel.POOL.hasDedicatedInstance()).isFalse();
  }

  @Test
  void bridgeTemNamespaceMasNaoInstancia() {
    assertThat(IsolationLevel.BRIDGE.hasDedicatedNamespace()).isTrue();
    assertThat(IsolationLevel.BRIDGE.hasDedicatedInstance()).isFalse();
  }

  @Test
  void siloTemNamespaceEInstancia() {
    assertThat(IsolationLevel.SILO.hasDedicatedNamespace()).isTrue();
    assertThat(IsolationLevel.SILO.hasDedicatedInstance()).isTrue();
  }

  @Test
  void parseIgnoraCaixaEEspacos() {
    assertThat(IsolationLevel.parse(" bridge ")).isEqualTo(IsolationLevel.BRIDGE);
    assertThat(IsolationLevel.parse("Silo")).isEqualTo(IsolationLevel.SILO);
  }

  @ParameterizedTest
  @NullAndEmptySource
  @ValueSource(strings = {"   "})
  void parseRejeitaVazio(String raw) {
    assertThatThrownBy(() -> IsolationLevel.parse(raw))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("obrigatório");
  }

  @Test
  void parseRejeitaValorDesconhecido() {
    assertThatThrownBy(() -> IsolationLevel.parse("hibrido"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("POOL, BRIDGE ou SILO");
  }
}
