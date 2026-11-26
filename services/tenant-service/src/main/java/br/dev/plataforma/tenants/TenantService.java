package br.dev.plataforma.tenants;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.TenantAlterado;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import br.dev.plataforma.core.TenantId;
import br.dev.plataforma.spring.outbox.Outbox;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Regras do cadastro. Toda mudança grava o tenant e o evento no outbox na mesma transação: ou os
 * dois ficam, ou nenhum (ADR-0003). Quem publica no Pulsar é o relay da biblioteca comum.
 */
@Service
public class TenantService {

  static final int MAX_PAGE = 100;

  private final MongoOperations mongo;
  private final Outbox outbox;
  private final Clock clock;

  public TenantService(MongoOperations mongo, Outbox outbox, Clock clock) {
    this.mongo = mongo;
    this.outbox = outbox;
    this.clock = clock;
  }

  @Transactional
  public TenantView create(NewTenant request) {
    String id = parseId(request.id());
    // Consulta antes de inserir: chave duplicada dentro da transação do MongoDB aborta a transação.
    // A corrida entre dois POSTs iguais ainda cai na chave única do _id (ver ApiErrors).
    if (mongo.exists(byId(id), TenantDocument.class)) {
      throw new TenantExceptions.AlreadyExists(id);
    }
    Instant now = now();
    NivelIsolamento nivel =
        request.nivelIsolamento() == null ? NivelIsolamento.POOL : request.nivelIsolamento();
    TenantDocument saved =
        mongo.insert(
            new TenantDocument(
                id, request.nome().strip(), request.plano(), nivel, true, now, now, null));
    outbox.append(
        TenantCriado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId(id)
            .setOccurredAt(now)
            .setNome(saved.nome())
            .setPlano(saved.plano())
            .setNivelIsolamento(saved.nivelIsolamento())
            .build(),
        id);
    return TenantView.of(saved);
  }

  @Transactional
  public TenantView change(String rawId, TenantChange change) {
    if (change.isEmpty()) {
      throw new TenantExceptions.InvalidRequest("Informe ao menos um campo para alterar.");
    }
    if (change.hasBlankName()) {
      throw new TenantExceptions.InvalidRequest("O nome não pode ficar em branco.");
    }
    String id = parseId(rawId);
    TenantDocument current = find(id);
    Instant now = now();
    TenantChange normalized =
        new TenantChange(
            change.nome() == null ? null : change.nome().strip(),
            change.plano(),
            change.nivelIsolamento(),
            change.ativo());
    // save() com @Version: se outra alteração gravou antes, lança OptimisticLockingFailure (409).
    TenantDocument saved = mongo.save(current.withChanges(normalized, now));
    outbox.append(
        TenantAlterado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId(id)
            .setOccurredAt(now)
            .setNome(saved.nome())
            .setPlano(saved.plano())
            .setNivelIsolamento(saved.nivelIsolamento())
            .setAtivo(saved.ativo())
            .build(),
        id);
    return TenantView.of(saved);
  }

  public TenantView get(String rawId) {
    return TenantView.of(find(parseId(rawId)));
  }

  /**
   * Lista em ordem de id. O cursor é o último id da página anterior, codificado em base64url para o
   * cliente tratá-lo como opaco.
   */
  public TenantView.Page list(String cursor, int limit) {
    if (limit < 1 || limit > MAX_PAGE) {
      throw new TenantExceptions.InvalidRequest("limite deve ficar entre 1 e " + MAX_PAGE + ".");
    }
    Criteria criteria = new Criteria();
    if (cursor != null && !cursor.isBlank()) {
      criteria = Criteria.where("_id").gt(decodeCursor(cursor));
    }
    List<TenantDocument> docs =
        mongo.find(
            Query.query(criteria).with(Sort.by("_id")).limit(limit + 1), TenantDocument.class);
    boolean hasMore = docs.size() > limit;
    List<TenantView> page = docs.stream().limit(limit).map(TenantView::of).toList();
    String next = hasMore ? encodeCursor(page.getLast().id()) : null;
    return new TenantView.Page(page, next);
  }

  private TenantDocument find(String id) {
    TenantDocument doc = mongo.findById(id, TenantDocument.class);
    if (doc == null) {
      throw new TenantExceptions.NotFound(id);
    }
    return doc;
  }

  /** Milissegundos bastam: é a precisão do MongoDB e do timestamp-millis do Avro. */
  private Instant now() {
    return clock.instant().truncatedTo(ChronoUnit.MILLIS);
  }

  private static Query byId(String id) {
    return Query.query(Criteria.where("_id").is(id));
  }

  private static String parseId(String raw) {
    try {
      return new TenantId(raw).value();
    } catch (IllegalArgumentException | NullPointerException e) {
      throw new TenantExceptions.InvalidRequest(e.getMessage());
    }
  }

  static String encodeCursor(String lastId) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(lastId.getBytes(StandardCharsets.UTF_8));
  }

  static String decodeCursor(String cursor) {
    try {
      return new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
    } catch (IllegalArgumentException e) {
      throw new TenantExceptions.InvalidRequest("cursor inválido.");
    }
  }
}
