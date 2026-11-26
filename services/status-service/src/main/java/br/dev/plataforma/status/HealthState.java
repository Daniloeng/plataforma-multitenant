package br.dev.plataforma.status;

/** Estado de saúde de um componente ou da plataforma como um todo. */
public enum HealthState {
  /** Tudo respondendo. */
  UP,
  /** Parte dos componentes fora do ar (só vale para a plataforma). */
  DEGRADED,
  /** Nada respondendo. */
  DOWN
}
