package br.dev.plataforma.status;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

class RuntimeInfoTest {

  @Test
  void noKubernetesUsaONamespaceDaDownwardApiEOPod() {
    var runtime =
        RuntimeInfo.detect(
            Map.of(
                "KUBERNETES_SERVICE_HOST", "10.96.0.1",
                "POD_NAMESPACE", "plataforma",
                "HOSTNAME", "status-service-5c8d-xk2p",
                "PLATAFORMA_RUNTIME", "compose"));
    assertThat(runtime)
        .isEqualTo(new RuntimeInfo("kubernetes", "plataforma", "status-service-5c8d-xk2p"));
  }

  @Test
  void noKubernetesSemNamespaceInformadoFicaNulo() {
    var runtime = RuntimeInfo.detect(Map.of("KUBERNETES_SERVICE_HOST", "10.96.0.1"));
    assertThat(runtime).isEqualTo(new RuntimeInfo("kubernetes", null, null));
  }

  @Test
  void foraDoKubernetesUsaOAmbienteDeclarado() {
    var runtime = RuntimeInfo.detect(Map.of("PLATAFORMA_RUNTIME", "compose", "HOSTNAME", "a1b2"));
    assertThat(runtime).isEqualTo(new RuntimeInfo("compose", null, "a1b2"));
  }

  @Test
  void semNadaDeclaradoELocal() {
    var runtime =
        RuntimeInfo.detect(Map.of("PLATAFORMA_RUNTIME", " ", "KUBERNETES_SERVICE_HOST", ""));
    assertThat(runtime).isEqualTo(new RuntimeInfo("local", null, null));
  }
}
