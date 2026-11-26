package br.dev.plataforma.spring.outbox;

/** Contexto de trace atual no formato W3C {@code traceparent}, ou null sem span ativo. */
@FunctionalInterface
public interface CurrentTrace {

  CurrentTrace NONE = () -> null;

  String traceparent();
}
