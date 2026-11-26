package br.dev.plataforma.status;

/**
 * Resultado da verificação de um componente.
 *
 * @param name nome do componente (ex.: mongo-pedidos)
 * @param type tipo do componente
 * @param status UP ou DOWN
 * @param latencyMs tempo da verificação em milissegundos
 * @param details informação extra (replica set, erro), pode ser nulo
 * @param metrics métricas do serviço (só serviços da plataforma que responderam), pode ser nulo
 */
public record ComponentStatus(
    String name,
    ComponentType type,
    HealthState status,
    long latencyMs,
    String details,
    ServiceMetrics metrics) {

  public ComponentStatus(
      String name, ComponentType type, HealthState status, long latencyMs, String details) {
    this(name, type, status, latencyMs, details, null);
  }

  public ComponentStatus withMetrics(ServiceMetrics metrics) {
    return new ComponentStatus(name, type, status, latencyMs, details, metrics);
  }

  public static ComponentStatus up(
      String name, ComponentType type, long latencyMs, String details) {
    return new ComponentStatus(name, type, HealthState.UP, latencyMs, details);
  }

  public static ComponentStatus down(
      String name, ComponentType type, long latencyMs, String details) {
    return new ComponentStatus(name, type, HealthState.DOWN, latencyMs, details);
  }
}
