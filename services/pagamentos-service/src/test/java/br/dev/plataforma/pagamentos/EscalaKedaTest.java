package br.dev.plataforma.pagamentos;

import static org.assertj.core.api.Assertions.assertThat;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.contracts.pedidos.PedidoCriado;
import java.io.FileReader;
import java.io.Reader;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

/**
 * O KEDA escala este serviço pelo backlog de uma assinatura do Pulsar (ADR-0016). O chart escreve
 * tópico e assinatura como texto; este teste os amarra ao catálogo de eventos e ao nome que o
 * {@code EventSubscriber} dá à assinatura ({@code <serviço>-<consumidor>}).
 */
class EscalaKedaTest {

  private static final String VALUES = "../../deploy/helm/plataforma/values.yaml";

  @Test
  @SuppressWarnings("unchecked")
  void chartEscalaPelaAssinaturaQueOServicoRealmenteUsa() throws Exception {
    Map<String, Object> keda;
    try (Reader r = new FileReader(VALUES)) {
      keda = (Map<String, Object>) ((Map<String, Object>) new Yaml().load(r)).get("keda");
    }
    assertThat(keda.get("service")).isEqualTo("pagamentos-service");
    assertThat(keda.get("topic"))
        .isEqualTo(EventCatalog.defaultCatalog().of(PedidoCriado.class).topic());
    assertThat(keda.get("subscription")).isEqualTo("pagamentos-service-" + PedidoEventos.CRIADO);
  }
}
