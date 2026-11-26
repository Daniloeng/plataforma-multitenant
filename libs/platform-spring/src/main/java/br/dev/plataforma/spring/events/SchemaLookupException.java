package br.dev.plataforma.spring.events;

/**
 * Falha temporária ao buscar o schema do escritor (ex.: admin do Pulsar fora do ar). Diferente de
 * uma mensagem ilegível, vale tentar de novo: o consumidor não deve descartar a mensagem.
 */
public class SchemaLookupException extends RuntimeException {

  public SchemaLookupException(String message, Throwable cause) {
    super(message, cause);
  }
}
