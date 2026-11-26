package br.dev.plataforma.pedidos;

import br.dev.plataforma.contracts.pagamentos.PagamentoAprovado;
import br.dev.plataforma.contracts.pagamentos.PagamentoRecusado;
import br.dev.plataforma.spring.events.EventSubscriber;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * O lado de Pedidos da saga (ADR-0006): pagamento aprovado confirma, recusado cancela. Eventos de
 * um pedido que já saiu de PENDENTE são ignorados.
 */
@Configuration(proxyBeanMethods = false)
public class PagamentoEventos {

  static final String APROVADO = "pagamento-aprovado";
  static final String RECUSADO = "pagamento-recusado";

  @Bean
  SmartInitializingSingleton pagamentoEventHandlers(
      EventSubscriber subscriber, PedidoService pedidos) {
    return () ->
        subscriber
            .on(
                PagamentoAprovado.class,
                APROVADO,
                e -> pedidos.confirmarPagamento(e.getPedidoId(), e.getPagamentoId()))
            .on(PagamentoRecusado.class, RECUSADO, e -> pedidos.recusarPagamento(e.getPedidoId()));
  }
}
