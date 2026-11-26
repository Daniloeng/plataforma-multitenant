package br.dev.plataforma.spring.events;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.apache.pulsar.client.api.Message;
import org.junit.jupiter.api.Test;

class TenantLanesTest {

  @SuppressWarnings("unchecked")
  private static Message<byte[]> mensagem(String chave) {
    Message<byte[]> m = mock(Message.class);
    when(m.getKey()).thenReturn(chave);
    return m;
  }

  @Test
  void tenantDaChave() {
    assertThat(TenantLanes.tenantOf("acme:ped-1")).isEqualTo("acme");
    assertThat(TenantLanes.tenantOf("acme")).isEqualTo("acme");
    assertThat(TenantLanes.tenantOf(null)).isEmpty();
  }

  @Test
  void umTenantParadoNaoSeguraOutroEAOrdemDoTenantSeMantem() throws Exception {
    TenantLanes lanes = new TenantLanes();
    CountDownLatch solta = new CountDownLatch(1);
    CountDownLatch vizinho = new CountDownLatch(1);
    List<String> ordem = new CopyOnWriteArrayList<>();
    lanes.execute(
        mensagem("lento:a"),
        () -> {
          try {
            solta.await(5, TimeUnit.SECONDS);
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
          ordem.add("lento-1");
        });
    lanes.execute(mensagem("lento:a"), () -> ordem.add("lento-2"));
    lanes.execute(mensagem("rapido:b"), vizinho::countDown);

    assertThat(vizinho.await(2, TimeUnit.SECONDS)).isTrue(); // não esperou o tenant lento
    assertThat(ordem).isEmpty();
    solta.countDown();
    for (int i = 0; i < 50 && ordem.size() < 2; i++) {
      Thread.sleep(20);
    }
    assertThat(ordem).containsExactly("lento-1", "lento-2");
    assertThat(lanes.size()).isEqualTo(2);
    lanes.close();
    assertThat(lanes.size()).isZero();
  }
}
