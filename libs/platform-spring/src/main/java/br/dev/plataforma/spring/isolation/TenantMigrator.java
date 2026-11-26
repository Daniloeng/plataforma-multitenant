package br.dev.plataforma.spring.isolation;

import br.dev.plataforma.core.TenantId;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.model.BulkWriteOptions;
import com.mongodb.client.model.DeleteOneModel;
import com.mongodb.client.model.Filters;
import com.mongodb.client.model.ReplaceOneModel;
import com.mongodb.client.model.ReplaceOptions;
import com.mongodb.client.model.WriteModel;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.bson.Document;
import org.bson.conversions.Bson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Job que move os dados de um tenant da database padrão para a dedicada (ADR-0014).
 *
 * <ol>
 *   <li>Espera a carência: as outras réplicas relêem o mapa e param de gravar na database antiga.
 *   <li>Garante coleções e índices na database nova (copiados da padrão).
 *   <li>Em passadas: copia os documentos do tenant (substituindo pelo {@code _id}) e apaga da
 *       origem só o que foi copiado, igual ao copiado. Uma gravação atrasada na origem fica para a
 *       passada seguinte, nunca é apagada sem cópia. Sem sobra depois de {@value #MAX_PASSES}
 *       passadas, falha.
 *   <li>Marca o tenant como pronto (só a dona do lease consegue).
 *   <li>Depois de mais uma carência, varre a origem: o que uma réplica atrasada ainda gravou lá é
 *       movido se não existir na nova; se existir, fica na origem e vira erro no log.
 * </ol>
 *
 * Cada migração roda na sua thread virtual e renova o lease a cada lote; quem perde o lease para.
 */
public class TenantMigrator implements AutoCloseable {

  private static final Logger LOG = LoggerFactory.getLogger(TenantMigrator.class);
  static final int BATCH = 500;
  static final int MAX_PASSES = 5;

  /** A réplica perdeu o lease da migração: para sem apagar nem marcar nada. */
  static final class LostLease extends RuntimeException {
    LostLease(TenantId tenant) {
      super("Outra réplica assumiu a migração do tenant " + tenant.value());
    }
  }

  private final MongoClient client;
  private final TenantPlacements placements;
  private final List<String> collections;
  private final Duration grace;
  private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
  private final Map<String, Boolean> running = new ConcurrentHashMap<>();
  private volatile boolean closed;

  /**
   * @param collections coleções de negócio que mudam de database com o tenant
   * @param grace espera antes de copiar, maior que a idade máxima do mapa nas réplicas
   */
  public TenantMigrator(
      MongoClient client, TenantPlacements placements, List<String> collections, Duration grace) {
    this.client = client;
    this.placements = placements;
    this.collections = List.copyOf(collections);
    this.grace = grace;
  }

  /** Agenda a migração do tenant (cada tenant na sua thread; repetir não duplica). */
  public void schedule(TenantId tenant) {
    if (!closed && running.putIfAbsent(tenant.value(), Boolean.TRUE) == null) {
      executor.submit(
          () -> {
            try {
              migrate(tenant);
            } catch (LostLease e) {
              LOG.warn(e.getMessage());
            } catch (RuntimeException e) {
              if (closed) {
                // Desligamento: o close() já soltou o lease; não conta como falha.
                LOG.info("Migração do tenant {} interrompida pelo desligamento", tenant);
                return;
              }
              int attempts = placements.of(tenant).attempts() + 1;
              LOG.error(
                  "Migração do tenant {} falhou (tentativa {}); outra tentativa na próxima rodada",
                  tenant,
                  attempts,
                  e);
              placements.release(tenant, true);
            } finally {
              running.remove(tenant.value());
            }
          });
    }
  }

  /** Se esta réplica está migrando o tenant agora. */
  public boolean isRunning(TenantId tenant) {
    return running.containsKey(tenant.value());
  }

  /** Migra agora, na thread atual. Devolve quantos documentos mudaram de database. */
  long migrate(TenantId tenant) {
    sleep(grace);
    placements.refresh();
    TenantPlacement p = placements.of(tenant);
    if (!p.migrating() || !placements.replica().equals(p.owner())) {
      return 0;
    }
    MongoDatabase source = client.getDatabase(placements.defaultDatabase());
    MongoDatabase target = client.getDatabase(p.database());
    syncCollections(target);
    long total = 0;
    for (String name : collections) {
      total += moveUntilEmpty(tenant, source.getCollection(name), target.getCollection(name));
    }
    if (!placements.markReady(tenant)) {
      throw new LostLease(tenant);
    }
    LOG.info(
        "Tenant {} migrou para {} ({}): {} documentos", tenant, p.database(), p.level(), total);
    sweep(tenant, source, target);
    return total;
  }

  /**
   * Garante na database dedicada as coleções de negócio e os índices da padrão (criar índice que já
   * existe não faz nada). Roda na migração e na subida do serviço, para índice novo chegar às
   * databases já migradas.
   */
  public void syncCollections(MongoDatabase target) {
    MongoDatabase source = client.getDatabase(placements.defaultDatabase());
    Set<String> existingInSource = new HashSet<>();
    source.listCollectionNames().into(existingInSource);
    Set<String> existingInTarget = new HashSet<>();
    target.listCollectionNames().into(existingInTarget);
    for (String name : collections) {
      if (!existingInTarget.contains(name)) {
        target.createCollection(name);
      }
      if (existingInSource.contains(name)) {
        copyIndexes(source.getCollection(name), target, name);
      }
    }
  }

  private long moveUntilEmpty(
      TenantId tenant, MongoCollection<Document> from, MongoCollection<Document> to) {
    Bson ofTenant = Filters.eq("tenantId", tenant.value());
    long moved = 0;
    for (int pass = 0; pass < MAX_PASSES; pass++) {
      moved += movePass(tenant, from, to);
      if (from.countDocuments(ofTenant) == 0) {
        return moved;
      }
    }
    throw new IllegalStateException(
        "A coleção "
            + from.getNamespace().getCollectionName()
            + " ainda recebe gravações do tenant "
            + tenant.value()
            + " na database antiga depois de "
            + MAX_PASSES
            + " passadas");
  }

  private long movePass(
      TenantId tenant, MongoCollection<Document> from, MongoCollection<Document> to) {
    long moved = 0;
    List<Document> batch = new ArrayList<>(BATCH);
    for (Document d : from.find(Filters.eq("tenantId", tenant.value()))) {
      batch.add(d);
      if (batch.size() == BATCH) {
        moved += moveBatch(tenant, batch, from, to);
        batch.clear();
      }
    }
    if (!batch.isEmpty()) {
      moved += moveBatch(tenant, batch, from, to);
    }
    return moved;
  }

  private long moveBatch(
      TenantId tenant,
      List<Document> batch,
      MongoCollection<Document> from,
      MongoCollection<Document> to) {
    if (!placements.heartbeat(tenant)) {
      throw new LostLease(tenant);
    }
    List<WriteModel<Document>> copies = new ArrayList<>(batch.size());
    List<DeleteOneModel<Document>> deletes = new ArrayList<>(batch.size());
    for (Document d : batch) {
      copies.add(
          new ReplaceOneModel<>(
              Filters.eq("_id", d.get("_id")), d, new ReplaceOptions().upsert(true)));
      deletes.add(new DeleteOneModel<>(sameAs(d)));
    }
    to.bulkWrite(copies, new BulkWriteOptions().ordered(false));
    // Só apaga o documento que continua igual ao copiado: gravação nova fica para a próxima
    // passada.
    from.bulkWrite(deletes, new BulkWriteOptions().ordered(false));
    return batch.size();
  }

  /**
   * Varredura depois do PRONTO: o que uma réplica atrasada gravou na origem vai para a nova se lá
   * não houver o mesmo {@code _id}; se houver, a nova é a verdade e a sobra fica na origem, com
   * erro no log para alguém olhar.
   */
  void sweep(TenantId tenant, MongoDatabase source, MongoDatabase target) {
    sleep(grace);
    for (String name : collections) {
      MongoCollection<Document> from = source.getCollection(name);
      MongoCollection<Document> to = target.getCollection(name);
      for (Document d : from.find(Filters.eq("tenantId", tenant.value()))) {
        if (to.find(Filters.eq("_id", d.get("_id"))).first() == null) {
          to.insertOne(d);
          from.deleteOne(sameAs(d));
          LOG.warn("Tenant {}: documento atrasado {} movido para {}", tenant, d.get("_id"), name);
        } else {
          LOG.error(
              "Tenant {}: documento {} de {} gravado na database antiga depois da migração;"
                  + " ficou lá para análise",
              tenant,
              d.get("_id"),
              name);
        }
      }
    }
  }

  /** Filtro que só casa com o documento se todos os campos continuam iguais. */
  private static Bson sameAs(Document d) {
    List<Bson> fields = new ArrayList<>();
    d.forEach((k, v) -> fields.add(Filters.eq(k, v)));
    return Filters.and(fields);
  }

  /** Copia as definições dos índices como estão (únicos, parciais, TTL), menos o do _id. */
  private static void copyIndexes(
      MongoCollection<Document> source, MongoDatabase target, String name) {
    List<Document> specs = new ArrayList<>();
    for (Document index : source.listIndexes()) {
      if ("_id_".equals(index.getString("name"))) {
        continue;
      }
      Document spec = new Document(index);
      spec.remove("v");
      spec.remove("ns");
      specs.add(spec);
    }
    if (!specs.isEmpty()) {
      target.runCommand(new Document("createIndexes", name).append("indexes", specs));
    }
  }

  private static void sleep(Duration d) {
    try {
      Thread.sleep(d);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("Migração interrompida", e);
    }
  }

  /** Desligamento: interrompe as migrações e solta os leases, para outra réplica assumir já. */
  @Override
  public void close() {
    closed = true;
    executor.shutdownNow();
    for (String tenant : running.keySet()) {
      try {
        placements.release(TenantId.of(tenant), false);
      } catch (RuntimeException e) {
        LOG.debug("Lease de {} não foi solto: {}", tenant, e.toString());
      }
    }
  }
}
