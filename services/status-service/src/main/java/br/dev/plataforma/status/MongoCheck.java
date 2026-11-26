package br.dev.plataforma.status;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import org.bson.Document;

/**
 * Verifica um MongoDB com o comando {@code hello}, que também informa o replica set.
 *
 * <p>O cliente é criado uma vez e reaproveitado; o timeout de seleção de servidor limita quanto
 * tempo uma instância fora do ar segura a resposta.
 */
public class MongoCheck implements ComponentCheck, AutoCloseable {

  private final String name;
  private final MongoClient client;

  public MongoCheck(String name, String uri, Duration timeout) {
    this(name, createClient(uri, timeout));
  }

  MongoCheck(String name, MongoClient client) {
    this.name = name;
    this.client = client;
  }

  private static MongoClient createClient(String uri, Duration timeout) {
    long millis = timeout.toMillis();
    MongoClientSettings settings =
        MongoClientSettings.builder()
            .applyConnectionString(new ConnectionString(uri))
            .applyToClusterSettings(b -> b.serverSelectionTimeout(millis, TimeUnit.MILLISECONDS))
            .applyToSocketSettings(
                b ->
                    b.connectTimeout((int) millis, TimeUnit.MILLISECONDS)
                        .readTimeout((int) millis, TimeUnit.MILLISECONDS))
            .build();
    return MongoClients.create(settings);
  }

  @Override
  public String name() {
    return name;
  }

  @Override
  public ComponentType type() {
    return ComponentType.MONGODB;
  }

  @Override
  public ComponentStatus check() {
    long start = System.nanoTime();
    try {
      Document hello = client.getDatabase("admin").runCommand(new Document("hello", 1));
      String setName = hello.getString("setName");
      String details = setName == null ? "standalone" : "replica set " + setName;
      return ComponentStatus.up(name, ComponentType.MONGODB, elapsed(start), details);
    } catch (RuntimeException e) {
      return ComponentStatus.down(
          name, ComponentType.MONGODB, elapsed(start), e.getClass().getSimpleName());
    }
  }

  private static long elapsed(long start) {
    return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
  }

  @Override
  public void close() {
    client.close();
  }
}
