package br.dev.plataforma.contracts;

import br.dev.plataforma.contracts.catalogo.PrecoAlterado;
import br.dev.plataforma.contracts.catalogo.ProdutoAlterado;
import br.dev.plataforma.contracts.pagamentos.PagamentoAprovado;
import br.dev.plataforma.contracts.pagamentos.PagamentoEstornado;
import br.dev.plataforma.contracts.pagamentos.PagamentoRecusado;
import br.dev.plataforma.contracts.pedidos.PedidoCancelado;
import br.dev.plataforma.contracts.pedidos.PedidoConfirmado;
import br.dev.plataforma.contracts.pedidos.PedidoCriado;
import br.dev.plataforma.contracts.tenants.TenantAlterado;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.apache.avro.Schema;

/**
 * Catálogo de todos os eventos da plataforma. É a fonte única de tópico, produtor e consumidores:
 * produtores e consumidores dos serviços resolvem o tópico por aqui, não por texto solto.
 */
public final class EventCatalog {

  private static final EventCatalog DEFAULT =
      new EventCatalog(
          List.of(
              TenantCriado.getClassSchema(),
              TenantAlterado.getClassSchema(),
              ProdutoAlterado.getClassSchema(),
              PrecoAlterado.getClassSchema(),
              PedidoCriado.getClassSchema(),
              PedidoConfirmado.getClassSchema(),
              PedidoCancelado.getClassSchema(),
              PagamentoAprovado.getClassSchema(),
              PagamentoRecusado.getClassSchema(),
              PagamentoEstornado.getClassSchema()));

  private final Map<String, EventContract> byEvent;
  private final List<EventContract> ordered;

  EventCatalog(Collection<Schema> schemas) {
    Map<String, EventContract> map = new LinkedHashMap<>();
    for (Schema schema : schemas) {
      EventContract contract = EventContract.from(schema);
      if (map.putIfAbsent(contract.event(), contract) != null) {
        throw new IllegalArgumentException("Evento duplicado no catálogo: " + contract.event());
      }
    }
    this.byEvent = Map.copyOf(map);
    this.ordered = List.copyOf(map.values());
  }

  /** Catálogo com todos os eventos gerados a partir de {@code src/main/avro}. */
  public static EventCatalog defaultCatalog() {
    return DEFAULT;
  }

  /** Todos os eventos, na ordem de declaração. */
  public List<EventContract> all() {
    return ordered;
  }

  /** Busca pelo nome do evento (ex.: {@code pagamento.aprovado}). */
  public Optional<EventContract> byEvent(String event) {
    return Optional.ofNullable(byEvent.get(event));
  }

  /** Contrato da classe gerada pelo Avro (ex.: {@code PedidoCriado.class}). */
  public EventContract of(Class<? extends org.apache.avro.specific.SpecificRecord> type) {
    return ordered.stream()
        .filter(c -> c.schema().getFullName().equals(type.getName()))
        .findFirst()
        .orElseThrow(
            () -> new IllegalArgumentException("Classe sem contrato no catálogo: " + type));
  }

  /** Eventos publicados por um serviço. */
  public List<EventContract> producedBy(String service) {
    return ordered.stream().filter(c -> c.producer().equals(service)).toList();
  }

  /** Eventos consumidos por um serviço. */
  public List<EventContract> consumedBy(String service) {
    return ordered.stream().filter(c -> c.consumers().contains(service)).toList();
  }
}
