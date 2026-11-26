package br.dev.plataforma.spring.outbox;

import com.mongodb.ErrorCategory;
import com.mongodb.MongoException;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.Filters;
import com.mongodb.client.model.FindOneAndUpdateOptions;
import com.mongodb.client.model.Updates;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
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
 * <p>A validade é comparada com o relógio de cada réplica: diferença de relógio entre réplicas
 * precisa ser bem menor que o {@code ttl}. Se duas réplicas publicarem juntas por um instante, a
 * entrega continua pelo menos uma vez e os consumidores deduplicam pelo eventId (ADR-0006).
 */
public class RelayLease {

  private static final Logger LOG = LoggerFactory.getLogger(RelayLease.class);

  public static final String COLLECTION = "outbox_relay_lease";
  static final String ID = "relay";

  private final MongoCollection<Document> collection;
  private final Clock clock;
  private final Duration ttl;
  private final String replica = UUID.randomUUID().toString();

  /** Validade do lease que esta réplica tem (null: não é dona). */
  private volatile Instant heldUntil;

  public RelayLease(MongoCollection<Document> collection, Clock clock, Duration ttl) {
    this.collection = collection;
    this.clock = clock;
    this.ttl = ttl;
  }

  public String replica() {
    return replica;
  }

  /** Se esta réplica é a dona agora (pela validade que ela mesma gravou). */
  public boolean isLeader() {
    Instant until = heldUntil;
    return until != null && clock.instant().isBefore(until);
  }

  /**
   * Garante o lease: renova se já é dona e passou da metade do prazo, assume se está livre ou
   * vencido. Devolve se esta réplica pode publicar.
   */
  public boolean tryAcquire() {
    Instant now = clock.instant();
    Instant until = heldUntil;
    if (until != null && now.isBefore(until.minus(ttl.dividedBy(2)))) {
      return true; // renovado há pouco
    }
    Instant next = now.plus(ttl);
    try {
      collection.findOneAndUpdate(
          Filters.and(
              Filters.eq("_id", ID),
              Filters.or(Filters.eq("owner", replica), Filters.lt("expiresAt", Date.from(now)))),
          Updates.combine(
              Updates.set("owner", replica),
              Updates.set("expiresAt", Date.from(next)),
              Updates.set("renewedAt", Date.from(now))),
          new FindOneAndUpdateOptions().upsert(true));
      if (until == null) {
        LOG.info("Esta réplica ({}) assumiu o relay do outbox", replica);
      }
      heldUntil = next;
      return true;
    } catch (MongoException e) {
      // findAndModify devolve a chave duplicada como erro de comando, não de escrita.
      if (ErrorCategory.fromErrorCode(e.getCode()) != ErrorCategory.DUPLICATE_KEY) {
        throw e;
      }
      // O documento existe com outra dona ainda válida: o upsert tentou criar outro e bateu no _id.
      if (until != null) {
        LOG.warn("Esta réplica ({}) perdeu o relay do outbox", replica);
      }
      heldUntil = null;
      return false;
    }
  }

  /** Solta o lease no desligamento, para outra réplica assumir já. */
  public void release() {
    if (heldUntil == null) {
      return;
    }
    heldUntil = null;
    try {
      collection.deleteOne(Filters.and(Filters.eq("_id", ID), Filters.eq("owner", replica)));
    } catch (RuntimeException e) {
      LOG.debug("Lease do relay não foi solto: {}", e.toString());
    }
  }
}
