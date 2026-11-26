package br.dev.plataforma.contracts;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import br.dev.plataforma.contracts.pedidos.ItemPedido;
import br.dev.plataforma.contracts.pedidos.PedidoCriado;
import org.apache.avro.util.ClassSecurityValidator;
import org.junit.jupiter.api.Test;

class AvroTrustTest {

  @Test
  void confiaNasClassesGeradasEContinuaRecusandoAsDemais() {
    AvroTrust.trustContracts();
    AvroTrust.trustContracts(); // idempotente

    assertThatCode(() -> ClassSecurityValidator.validate(PedidoCriado.class))
        .doesNotThrowAnyException();
    assertThatCode(() -> ClassSecurityValidator.validate(ItemPedido.class))
        .doesNotThrowAnyException();
    // Padrões do Avro continuam valendo
    assertThatCode(() -> ClassSecurityValidator.validate(String.class)).doesNotThrowAnyException();
    // E classes de fora continuam proibidas
    assertThatThrownBy(() -> ClassSecurityValidator.validate(java.util.concurrent.Executors.class))
        .isInstanceOf(SecurityException.class);
  }
}
