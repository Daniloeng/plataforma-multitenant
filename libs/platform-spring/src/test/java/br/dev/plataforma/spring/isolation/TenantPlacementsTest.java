package br.dev.plataforma.spring.isolation;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class TenantPlacementsTest {

  @Test
  void esperaEntreTentativasDobraAteCincoMinutos() {
    assertThat(TenantPlacements.backoff(0)).isEqualTo(Duration.ofSeconds(10));
    assertThat(TenantPlacements.backoff(1)).isEqualTo(Duration.ofSeconds(10));
    assertThat(TenantPlacements.backoff(2)).isEqualTo(Duration.ofSeconds(20));
    assertThat(TenantPlacements.backoff(3)).isEqualTo(Duration.ofSeconds(40));
    assertThat(TenantPlacements.backoff(6)).isEqualTo(Duration.ofMinutes(5));
    assertThat(TenantPlacements.backoff(50)).isEqualTo(Duration.ofMinutes(5));
  }
}
