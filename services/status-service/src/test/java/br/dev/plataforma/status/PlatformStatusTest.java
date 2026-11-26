package br.dev.plataforma.status;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class PlatformStatusTest {

  private static ComponentStatus up(String n) {
    return ComponentStatus.up(n, ComponentType.MONGODB, 1, null);
  }

  private static ComponentStatus down(String n) {
    return ComponentStatus.down(n, ComponentType.MONGODB, 1, "erro");
  }

  @Test
  void todosUpDaUp() {
    assertThat(PlatformStatus.aggregate(List.of(up("a"), up("b")))).isEqualTo(HealthState.UP);
  }

  @Test
  void algunsDownDaDegraded() {
    assertThat(PlatformStatus.aggregate(List.of(up("a"), down("b"))))
        .isEqualTo(HealthState.DEGRADED);
  }

  @Test
  void todosDownDaDown() {
    assertThat(PlatformStatus.aggregate(List.of(down("a"), down("b")))).isEqualTo(HealthState.DOWN);
  }

  @Test
  void semComponentesDaDown() {
    assertThat(PlatformStatus.aggregate(List.of())).isEqualTo(HealthState.DOWN);
  }
}
