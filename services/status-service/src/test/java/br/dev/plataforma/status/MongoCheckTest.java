package br.dev.plataforma.status;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mongodb.MongoTimeoutException;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoDatabase;
import java.io.IOException;
import java.net.ServerSocket;
import java.time.Duration;
import org.bson.Document;
import org.bson.conversions.Bson;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MongoDBContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
class MongoCheckTest {

  @Container static final MongoDBContainer MONGO = new MongoDBContainer("mongo:8.0");

  @Test
  void mongoDeVerdadeEmReplicaSetDaUp() {
    try (var check =
        new MongoCheck("mongo-pedidos", MONGO.getReplicaSetUrl(), Duration.ofSeconds(5))) {
      ComponentStatus status = check.check();

      assertThat(status.status()).isEqualTo(HealthState.UP);
      assertThat(status.name()).isEqualTo("mongo-pedidos");
      assertThat(status.type()).isEqualTo(ComponentType.MONGODB);
      assertThat(status.details()).startsWith("replica set ");
      assertThat(check.type()).isEqualTo(ComponentType.MONGODB);
      assertThat(check.name()).isEqualTo("mongo-pedidos");
    }
  }

  @Test
  void mongoInacessivelDaDownDentroDoTimeout() throws IOException {
    int portaLivre;
    try (ServerSocket socket = new ServerSocket(0)) {
      portaLivre = socket.getLocalPort();
    }
    String uri = "mongodb://127.0.0.1:" + portaLivre + "/?directConnection=true";

    try (var check = new MongoCheck("mongo-x", uri, Duration.ofMillis(300))) {
      long inicio = System.nanoTime();
      ComponentStatus status = check.check();
      long ms = Duration.ofNanos(System.nanoTime() - inicio).toMillis();

      assertThat(status.status()).isEqualTo(HealthState.DOWN);
      assertThat(status.details()).isEqualTo("MongoTimeoutException");
      assertThat(ms).isLessThan(3000);
    }
  }

  @Test
  void mongoSemReplicaSetEhStandalone() {
    MongoClient client = mock(MongoClient.class);
    MongoDatabase admin = mock(MongoDatabase.class);
    when(client.getDatabase("admin")).thenReturn(admin);
    when(admin.runCommand(any(Bson.class))).thenReturn(new Document("ok", 1));

    var check = new MongoCheck("mongo", client);

    assertThat(check.check().details()).isEqualTo("standalone");
    check.close();
    verify(client).close();
  }

  @Test
  void excecaoDoDriverViraDown() {
    MongoClient client = mock(MongoClient.class);
    when(client.getDatabase("admin")).thenThrow(new MongoTimeoutException("sem servidor"));

    ComponentStatus status = new MongoCheck("mongo", client).check();

    assertThat(status.status()).isEqualTo(HealthState.DOWN);
    assertThat(status.details()).isEqualTo("MongoTimeoutException");
  }
}
