package br.dev.plataforma.pedidos;

import br.dev.plataforma.contracts.pagamentos.PagamentoAprovado;
import br.dev.plataforma.contracts.pagamentos.PagamentoEstornado;
import br.dev.plataforma.contracts.pagamentos.PagamentoRecusado;
import br.dev.plataforma.spring.events.EventSubscriber;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * O lado de Pedidos da saga (ADR-0006): pagamento aprovado confirma, recusado cancela e estornado
 * entra na linha do tempo. Aprovado ou recusado de um pedido que já saiu de PENDENTE é ignorado.
 */
@Configuration(proxyBeanMethods = false)
public class PagamentoEventos {

  static final String APROVADO = "pagamento-aprovado";
  static final String RECUSADO = "pagamento-recusado";
  static final String ESTORNADO = "pagamento-estornado";

  @Bean
  SmartInitializingSingleton pagamentoEventHandlers(
      EventSubscriber subscriber, PedidoService pedidos) {
    return () ->
        subscriber
            .on(
                PagamentoAprovado.class,
                APROVADO,
                e -> pedidos.confirmarPagamento(e.getPedidoId(), e.getPagamentoId()))
            .on(
                PagamentoRecusado.class,
                RECUSADO,
                e -> pedidos.recusarPagamento(e.getPedidoId(), e.getMotivo()))
            .on(
                PagamentoEstornado.class,
                ESTORNADO,
                e -> pedidos.registrarEstorno(e.getPedidoId(), e.getPagamentoId()));
  }
}
