package br.dev.plataforma.status;

/** Uma verificação de saúde. Implementações não devem lançar exceção: falha vira DOWN. */
public interface ComponentCheck {

  /** Nome do componente verificado. */
  String name();

  /** Tipo do componente verificado. */
  ComponentType type();

  /** Executa a verificação. */
  ComponentStatus check();
}
