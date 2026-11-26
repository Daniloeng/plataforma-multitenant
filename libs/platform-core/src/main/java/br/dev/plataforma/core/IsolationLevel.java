package br.dev.plataforma.core;

/**
 * Nível de isolamento de um tenant. Ver a seção "Modelo multi-tenant e isolamento" do plano.
 *
 * <ul>
 *   <li>{@link #POOL}: coleções e tópicos compartilhados, filtrados por tenantId.
 *   <li>{@link #BRIDGE}: database e namespace Pulsar dedicados, mesma instância.
 *   <li>{@link #SILO}: instância MongoDB e namespace Kubernetes próprios.
 * </ul>
 */
public enum IsolationLevel {
  POOL(false, false),
  BRIDGE(true, false),
  SILO(true, true);

  private final boolean dedicatedNamespace;
  private final boolean dedicatedInstance;

  IsolationLevel(boolean dedicatedNamespace, boolean dedicatedInstance) {
    this.dedicatedNamespace = dedicatedNamespace;
    this.dedicatedInstance = dedicatedInstance;
  }

  /** Se o tenant tem database e namespace Pulsar próprios. */
  public boolean hasDedicatedNamespace() {
    return dedicatedNamespace;
  }

  /** Se o tenant tem instância MongoDB e namespace Kubernetes próprios. */
  public boolean hasDedicatedInstance() {
    return dedicatedInstance;
  }

  /** Converte texto (ex.: "bridge") no nível correspondente. */
  public static IsolationLevel parse(String raw) {
    if (raw == null || raw.isBlank()) {
      throw new IllegalArgumentException("Nível de isolamento é obrigatório");
    }
    try {
      return valueOf(raw.strip().toUpperCase(java.util.Locale.ROOT));
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException(
          "Nível de isolamento desconhecido: '" + raw + "'. Use POOL, BRIDGE ou SILO.", e);
    }
  }
}
