package br.dev.plataforma.spring.outbox;

import com.mongodb.ErrorCategory;
import com.mongodb.MongoException;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.Filters;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import org.bson.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Lease do relay do outbox (ADR-0015): com várias réplicas do serviço, só a dona publica, para não
 * embaralhar a ordem por agregado. Um documento em {@value #COLLECTION}, na database padrão, guarda
 * a dona e a validade; a réplica dona renova antes da metade do prazo, e qualquer réplica assume
 * quando a validade passa (a dona caiu ou travou).
 *
 * <p>A validade é gravada e comparada com o relógio do MongoDB ({@code $$NOW}), não com o das
 * réplicas. Localmente, a réplica conta o prazo a partir de antes do pedido, então ela se considera
 * dona por no máximo o que o servidor concedeu. Depois de {@link #release()}, nunca mais assume.
 */
public class RelayLease {

  private static final Logger LOG = LoggerFactory.getLogger(RelayLease.class);

  public static final String COLLECTION = "outbox_relay_lease";
  static final String ID = "relay";

  private final MongoCollection<Document> collection;
  private final Clock clock;
  private final Duration ttl;
  private final String replica = UUID.randomUUID().toString();

  /** Validade do lease que esta réplica tem, pelo relógio local (null: não é dona). */
  private volatile Instant heldUntil;

  private volatile boolean closed;
  private volatile boolean documentExists;

  public RelayLease(MongoCollection<Document> collection, Clock clock, Duration ttl) {
    this.collection = collection;
    this.clock = clock;
    this.ttl = ttl;
  }

  public String replica() {
    return replica;
  }

  /** Se esta réplica é a dona agora (pela validade que ela mesma conta). */
  public boolean isLeader() {
    Instant until = heldUntil;
    return !closed && until != null && clock.instant().isBefore(until);
  }

  /**
   * Garante o lease: renova se já é dona e passou da metade do prazo, assume se está livre ou
   * vencido. Devolve se esta réplica pode publicar.
   */
  public boolean tryAcquire() {
    if (closed) {
      return false;
    }
    Instant now = clock.instant();
    Instant until = heldUntil;
    if (until != null && now.isBefore(until.minus(ttl.dividedBy(2)))) {
      return true; // renovado há pouco
    }
    ensureDocument();
    // Sem upsert: o MongoDB não aceita $expr no filtro de um upsert. O documento já existe.
    Document granted =
        collection.findOneAndUpdate(
            Filters.and(
                Filters.eq("_id", ID),
                Filters.or(
                    Filters.eq("owner", replica),
                    Filters.expr(new Document("$lt", List.of("$expiresAt", "$$NOW"))))),
            List.of(
                new Document(
                    "$set",
                    new Document("owner", replica)
                        .append("expiresAt", new Document("$add", List.of("$$NOW", ttl.toMillis())))
                        .append("renewedAt", "$$NOW"))));
    if (granted == null) {
      // Outra réplica é dona e a validade dela não passou.
      if (until != null) {
        LOG.warn("Esta réplica ({}) perdeu o relay do outbox", replica);
      }
      heldUntil = null;
      return false;
    }
    if (closed) {
      release(); // desligou durante a renovação: devolve o que acabou de pegar
      return false;
    }
    if (until == null) {
      LOG.info("Esta réplica ({}) assumiu o relay do outbox", replica);
    }
    heldUntil = now.plus(ttl);
    return true;
  }

  /** Cria o documento do lease, já vencido, se ainda não existe. */
  private void ensureDocument() {
    if (documentExists) {
      return;
    }
    try {
      collection.insertOne(
          new Document("_id", ID).append("owner", null).append("expiresAt", new Date(0)));
    } catch (MongoException e) {
      if (ErrorCategory.fromErrorCode(e.getCode()) != ErrorCategory.DUPLICATE_KEY) {
        throw e;
      }
    }
    documentExists = true;
  }

  /** Solta o lease no desligamento, para outra réplica assumir já; depois disso, nunca assume. */
  public void release() {
    closed = true;
    heldUntil = null;
    try {
      // Vence na hora, sem apagar: a próxima réplica assume no ciclo seguinte.
      collection.updateOne(
          Filters.and(Filters.eq("_id", ID), Filters.eq("owner", replica)),
          new Document("$set", new Document("owner", null).append("expiresAt", new Date(0))));
    } catch (RuntimeException e) {
      LOG.debug("Lease do relay não foi solto: {}", e.toString());
    }
  }
}
