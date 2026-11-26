package br.dev.plataforma.spring.outbox;

/** Publica uma mensagem do outbox no broker. Falha com exceção; o relay tenta de novo depois. */
public interface EventPublisher {

  void publish(OutboxMessage message) throws Exception;
}
