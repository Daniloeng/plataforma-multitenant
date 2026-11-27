package br.dev.plataforma.status;

import java.util.Map;

/**
 * Onde a plataforma está rodando (Dia 11), para a página de saúde mostrar se é o Compose ou o
 * Kubernetes.
 *
 * @param platform {@code kubernetes}, {@code compose} ou {@code local}
 * @param namespace namespace do Kubernetes; null fora dele
 * @param instance nome da instância que respondeu (o pod no Kubernetes, o contêiner no Compose)
 */
public record RuntimeInfo(String platform, String namespace, String instance) {

  public static final String KUBERNETES = "kubernetes";
  public static final String LOCAL = "local";

  /**
   * Detecta pelo ambiente: o Kubernetes sempre define {@code KUBERNETES_SERVICE_HOST}; o chart
   * passa o namespace em {@code POD_NAMESPACE} (downward API). Fora dele, {@code
   * PLATAFORMA_RUNTIME} nomeia o ambiente (o Compose define {@code compose}).
   */
  public static RuntimeInfo detect(Map<String, String> env) {
    String instance = blankToNull(env.get("HOSTNAME"));
    if (blankToNull(env.get("KUBERNETES_SERVICE_HOST")) != null) {
      return new RuntimeInfo(KUBERNETES, blankToNull(env.get("POD_NAMESPACE")), instance);
    }
    String declared = blankToNull(env.get("PLATAFORMA_RUNTIME"));
    return new RuntimeInfo(declared == null ? LOCAL : declared, null, instance);
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.strip();
  }
}
