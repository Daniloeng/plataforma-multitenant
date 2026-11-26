package br.dev.plataforma.status;

import java.time.Instant;
import java.util.List;

/**
 * Resposta de {@code GET /api/status}. É o contrato consumido pelo frontend.
 *
 * @param status estado agregado da plataforma
 * @param checkedAt instante da verificação
 * @param version versão do status-service
 * @param components resultado por componente
 * @param runtime onde a plataforma está rodando (Dia 11); null quando não informado
 */
public record PlatformStatus(
    HealthState status,
    Instant checkedAt,
    String version,
    List<ComponentStatus> components,
    RuntimeInfo runtime) {

  public PlatformStatus(
      HealthState status, Instant checkedAt, String version, List<ComponentStatus> components) {
    this(status, checkedAt, version, components, null);
  }

  /** Agrega os estados: todos UP = UP, nenhum UP = DOWN, senão DEGRADED. */
  public static HealthState aggregate(List<ComponentStatus> components) {
    if (components.isEmpty()) {
      return HealthState.DOWN;
    }
    long up = components.stream().filter(c -> c.status() == HealthState.UP).count();
    if (up == components.size()) {
      return HealthState.UP;
    }
    return up == 0 ? HealthState.DOWN : HealthState.DEGRADED;
  }
}
