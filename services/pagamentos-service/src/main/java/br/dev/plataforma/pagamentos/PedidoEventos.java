package br.dev.plataforma.pagamentos;

import br.dev.plataforma.contracts.pedidos.PedidoCancelado;
import br.dev.plataforma.contracts.pedidos.PedidoCriado;
import br.dev.plataforma.spring.events.EventSubscriber;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Assinaturas dos eventos de pedido (ADR-0010): pagamentos-pedido-criado e -pedido-cancelado. */
@Configuration(proxyBeanMethods = false)
public class PedidoEventos {

  static final String CRIADO = "pedido-criado";
  static final String CANCELADO = "pedido-cancelado";

  @Bean
  SmartInitializingSingleton pedidoEventHandlers(
      EventSubscriber subscriber, CobrancaService cobranca) {
    return () ->
        subscriber
            .on(PedidoCriado.class, CRIADO, cobranca::cobrar)
            .on(PedidoCancelado.class, CANCELADO, cobranca::cancelar);
  }
}
