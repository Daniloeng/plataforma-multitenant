package br.dev.plataforma.catalogo;

import br.dev.plataforma.contracts.catalogo.PrecoAlterado;
import br.dev.plataforma.contracts.catalogo.ProdutoAlterado;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.spring.outbox.Outbox;
import br.dev.plataforma.spring.tenancy.TenantContext;
import br.dev.plataforma.spring.tenancy.TenantQueries;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Regras do catálogo. Toda mudança grava o produto e o evento no outbox na mesma transação
 * (ADR-0003), e toda consulta é filtrada pelo tenant do contexto ({@link TenantQueries}).
 */
@Service
public class ProdutoService {

  static final int MAX_PAGE = 100;

  private final MongoOperations mongo;
  private final Outbox outbox;
  private final Clock clock;
  private final CatalogoProperties props;

  public ProdutoService(
      MongoOperations mongo, Outbox outbox, Clock clock, CatalogoProperties props) {
    this.mongo = mongo;
    this.outbox = outbox;
    this.clock = clock;
    this.props = props;
  }

  @Transactional
  public ProdutoView criar(NovoProduto req) {
    TenantPlano tenant = tenantLocal();
    exigirAtivo(tenant);
    String nome = nomeValido(req.nome());
    // Consulta antes de inserir: chave duplicada dentro da transação aborta a transação inteira.
    // A corrida entre dois POSTs com o mesmo SKU cai no índice único (ApiErrors responde 409).
    if (mongo.exists(
        TenantQueries.scoped(Criteria.where("sku").is(req.sku())), ProdutoDocument.class)) {
      throw new CatalogoExceptions.SkuDuplicado(req.sku());
    }
    Plano plano = planoDe(tenant);
    int limite = props.limiteDe(plano);
    if (mongo.count(TenantQueries.scoped(), ProdutoDocument.class) >= limite) {
      throw new CatalogoExceptions.LimiteDoPlano(plano.name(), limite);
    }
    Instant agora = agora();
    ProdutoDocument salvo =
        mongo.insert(
            new ProdutoDocument(
                UUID.randomUUID().toString(),
                req.sku(),
                nome,
                req.preco().centavos(),
                req.preco().moeda(),
                agora));
    publicarProduto(salvo, agora);
    publicarPreco(salvo, agora);
    return ProdutoView.of(salvo);
  }

  @Transactional
  public ProdutoView alterar(String id, AlteracaoProduto alteracao) {
    if (alteracao.vazia()) {
      throw new CatalogoExceptions.RequisicaoInvalida("Informe nome ou ativo.");
    }
    exigirAtivo(tenantLocal());
    ProdutoDocument doc = buscar(id, true);
    Instant agora = agora();
    String nome = alteracao.nome() == null ? null : nomeValido(alteracao.nome());
    if (!doc.alterar(nome, alteracao.ativo(), agora)) {
      return ProdutoView.of(doc); // nada mudou: sem gravação e sem evento
    }
    ProdutoDocument salvo = mongo.save(doc);
    publicarProduto(salvo, agora);
    return ProdutoView.of(salvo);
  }

  @Transactional
  public ProdutoView alterarPreco(String id, Dinheiro preco) {
    exigirAtivo(tenantLocal());
    ProdutoDocument doc = buscar(id, true);
    Instant agora = agora();
    if (!doc.alterarPreco(preco.centavos(), preco.moeda(), agora)) {
      return ProdutoView.of(doc);
    }
    ProdutoDocument salvo = mongo.save(doc);
    publicarPreco(salvo, agora);
    return ProdutoView.of(salvo);
  }

  /**
   * @param incluirInativos gestores veem inativos; compradores recebem 404 para produto inativo
   */
  public ProdutoView obter(String id, boolean incluirInativos) {
    return ProdutoView.of(buscar(id, incluirInativos));
  }

  /**
   * Lista em ordem de SKU. O cursor é o último SKU da página anterior, em base64url (opaco para o
   * cliente).
   *
   * @param ativo filtro de situação; null traz todos
   */
  public ProdutoView.Pagina listar(String busca, Boolean ativo, String cursor, int limite) {
    if (limite < 1 || limite > MAX_PAGE) {
      throw new CatalogoExceptions.RequisicaoInvalida(
          "limite deve ficar entre 1 e " + MAX_PAGE + ".");
    }
    List<Criteria> filtros = new ArrayList<>();
    if (ativo != null) {
      filtros.add(Criteria.where("ativo").is(ativo));
    }
    if (busca != null && !busca.isBlank()) {
      if (busca.length() > 100) {
        throw new CatalogoExceptions.RequisicaoInvalida("busca aceita até 100 caracteres.");
      }
      Pattern trecho = Pattern.compile(Pattern.quote(busca.strip()), Pattern.CASE_INSENSITIVE);
      filtros.add(
          new Criteria()
              .orOperator(
                  Criteria.where("nome").regex(trecho), Criteria.where("sku").regex(trecho)));
    }
    Criteria filtro = filtros.isEmpty() ? new Criteria() : new Criteria().andOperator(filtros);
    long total = mongo.count(TenantQueries.scoped(filtro), ProdutoDocument.class);
    List<Criteria> pagina = new ArrayList<>(filtros);
    if (cursor != null && !cursor.isBlank()) {
      pagina.add(Criteria.where("sku").gt(decodificarCursor(cursor)));
    }
    Query query =
        TenantQueries.scoped(pagina.isEmpty() ? new Criteria() : new Criteria().andOperator(pagina))
            .with(Sort.by("sku"))
            .limit(limite + 1);
    List<ProdutoDocument> docs = mongo.find(query, ProdutoDocument.class);
    boolean temMais = docs.size() > limite;
    List<ProdutoView> itens = docs.stream().limit(limite).map(ProdutoView::of).toList();
    String proximo = temMais ? codificarCursor(itens.getLast().sku()) : null;
    long usados = mongo.count(TenantQueries.scoped(), ProdutoDocument.class);
    Plano plano = planoDe(tenantLocal());
    return new ProdutoView.Pagina(itens, proximo, total, props.limiteDe(plano), plano, usados);
  }

  /**
   * Plano do tenant pela cópia local. Se o evento tenant.criado ainda não chegou (milissegundos
   * depois da criação), vale o plano mais restrito: o limite nunca é maior do que o contratado.
   */
  static Plano planoDe(TenantPlano tenant) {
    return tenant == null ? Plano.GRATUITO : tenant.getPlano();
  }

  /** Cópia local do tenant atual; null se o tenant.criado ainda não chegou. */
  private TenantPlano tenantLocal() {
    TenantContext.require();
    return mongo.findOne(TenantQueries.scoped(), TenantPlano.class);
  }

  /**
   * Tenant suspenso não altera o catálogo, mesmo que o gateway ainda não tenha aprendido a
   * suspensão (ou alguém chame o serviço sem passar por ele). Tenant desconhecido passa: o evento
   * de criação pode estar a caminho.
   */
  private static void exigirAtivo(TenantPlano tenant) {
    if (tenant != null && !tenant.isAtivo()) {
      throw new CatalogoExceptions.TenantSuspenso();
    }
  }

  private ProdutoDocument buscar(String id, boolean incluirInativos) {
    Criteria criteria = Criteria.where("_id").is(id);
    if (!incluirInativos) {
      criteria = criteria.and("ativo").is(true);
    }
    ProdutoDocument doc = mongo.findOne(TenantQueries.scoped(criteria), ProdutoDocument.class);
    if (doc == null) {
      throw new CatalogoExceptions.NaoEncontrado(id);
    }
    return doc;
  }

  private void publicarProduto(ProdutoDocument p, Instant agora) {
    outbox.append(
        ProdutoAlterado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId(p.getTenantId())
            .setOccurredAt(agora)
            .setProdutoId(p.getId())
            .setSku(p.getSku())
            .setNome(p.getNome())
            .setAtivo(p.isAtivo())
            .setVersao(versao(p))
            .build(),
        p.getId());
  }

  private void publicarPreco(ProdutoDocument p, Instant agora) {
    outbox.append(
        PrecoAlterado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId(p.getTenantId())
            .setOccurredAt(agora)
            .setProdutoId(p.getId())
            .setSku(p.getSku())
            .setPrecoCentavos(p.getPrecoCentavos())
            .setMoeda(p.getMoeda())
            .setVersao(versao(p))
            .build(),
        p.getId());
  }

  private static long versao(ProdutoDocument p) {
    return p.getVersion() == null ? 0 : p.getVersion();
  }

  private Instant agora() {
    return clock.instant().truncatedTo(ChronoUnit.MILLIS);
  }

  private static String nomeValido(String raw) {
    String nome = raw.strip();
    if (nome.length() < 2) {
      throw new CatalogoExceptions.RequisicaoInvalida(
          "O nome precisa de ao menos 2 caracteres além de espaços.");
    }
    return nome;
  }

  static String codificarCursor(String sku) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(sku.getBytes(StandardCharsets.UTF_8));
  }

  static String decodificarCursor(String cursor) {
    try {
      return new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
    } catch (IllegalArgumentException e) {
      throw new CatalogoExceptions.RequisicaoInvalida("cursor inválido.");
    }
  }
}
