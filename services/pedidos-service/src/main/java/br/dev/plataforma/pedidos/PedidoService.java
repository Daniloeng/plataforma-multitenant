package br.dev.plataforma.pedidos;

import br.dev.plataforma.contracts.pedidos.ItemPedido;
import br.dev.plataforma.contracts.pedidos.PedidoCancelado;
import br.dev.plataforma.contracts.pedidos.PedidoConfirmado;
import br.dev.plataforma.contracts.pedidos.PedidoCriado;
import br.dev.plataforma.spring.outbox.Outbox;
import br.dev.plataforma.spring.tenancy.TenantContext;
import br.dev.plataforma.spring.tenancy.TenantQueries;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Regras dos pedidos. Toda mudança grava o pedido e o evento no outbox na mesma transação
 * (ADR-0003), e toda consulta é filtrada pelo tenant do contexto ({@link TenantQueries}).
 */
@Service
public class PedidoService {

  static final int MAX_PAGE = 100;

  /** Chave de idempotência: 8 a 64 caracteres ASCII visíveis (um UUID cabe com folga). */
  static final Pattern CHAVE = Pattern.compile("^[\\x21-\\x7E]{8,64}$");

  private final MongoOperations mongo;
  private final Outbox outbox;
  private final Clock clock;

  public PedidoService(MongoOperations mongo, Outbox outbox, Clock clock) {
    this.mongo = mongo;
    this.outbox = outbox;
    this.clock = clock;
  }

  /**
   * Cria o pedido com o preço da cópia local do catálogo, ou devolve o que a mesma chave já criou.
   * A chave vale por cliente dentro do tenant (índice único {@code ux_idempotencia}).
   */
  @Transactional
  public PedidoView.Criacao criar(String clienteId, String chave, NovoPedido req) {
    TenantContext.require();
    exigirTenantAtivo();
    if (chave == null || !CHAVE.matcher(chave).matches()) {
      throw new PedidosExceptions.RequisicaoInvalida(
          "Envie o cabeçalho Idempotency-Key com 8 a 64 caracteres (ex.: um UUID).");
    }
    String hash = hash(req);
    // Consulta antes de inserir: chave duplicada dentro da transação aborta a transação inteira.
    // Dois POSTs simultâneos com a mesma chave caem no índice único (ApiErrors responde 409).
    PedidoDocument existente =
        mongo.findOne(
            TenantQueries.scoped(
                Criteria.where("clienteId").is(clienteId).and("idempotencyKey").is(chave)),
            PedidoDocument.class);
    if (existente != null) {
      if (!existente.getRequestHash().equals(hash)) {
        throw new PedidosExceptions.ChaveReutilizada();
      }
      return new PedidoView.Criacao(PedidoView.of(existente, false), true);
    }

    Set<String> ids = new LinkedHashSet<>();
    for (NovoPedido.Item item : req.itens()) {
      if (!ids.add(item.produtoId())) {
        throw new PedidosExceptions.RequisicaoInvalida(
            "O produto '" + item.produtoId() + "' aparece mais de uma vez; some as quantidades.");
      }
    }
    Map<String, ProdutoLocal> produtos =
        mongo
            .find(TenantQueries.scoped(Criteria.where("produtoId").in(ids)), ProdutoLocal.class)
            .stream()
            .collect(Collectors.toMap(ProdutoLocal::getProdutoId, Function.identity()));
    List<String> indisponiveis =
        ids.stream()
            .filter(id -> produtos.get(id) == null || !produtos.get(id).disponivel())
            .toList();
    if (!indisponiveis.isEmpty()) {
      throw new PedidosExceptions.ProdutoIndisponivel(indisponiveis);
    }
    Set<String> moedas = new HashSet<>();
    produtos.values().forEach(p -> moedas.add(p.getMoeda()));
    if (moedas.size() > 1) {
      throw new PedidosExceptions.RequisicaoInvalida(
          "Os produtos têm moedas diferentes ("
              + String.join(", ", new java.util.TreeSet<>(moedas))
              + "); faça um pedido por moeda.");
    }

    List<PedidoDocument.Item> itens = new ArrayList<>();
    long total = 0;
    for (NovoPedido.Item item : req.itens()) {
      ProdutoLocal p = produtos.get(item.produtoId());
      itens.add(
          new PedidoDocument.Item(
              p.getProdutoId(), p.getSku(), p.getNome(), item.quantidade(), p.getPrecoCentavos()));
      try {
        total = Math.addExact(total, Math.multiplyExact(p.getPrecoCentavos(), item.quantidade()));
      } catch (ArithmeticException e) {
        throw new PedidosExceptions.RequisicaoInvalida(
            "O total do pedido é grande demais; divida em pedidos menores.");
      }
    }
    Instant agora = agora();
    PedidoDocument salvo =
        mongo.insert(
            new PedidoDocument(
                UUID.randomUUID().toString(),
                clienteId,
                chave,
                hash,
                itens,
                total,
                moedas.iterator().next(),
                agora));
    publicarCriado(salvo, agora);
    return new PedidoView.Criacao(PedidoView.of(salvo, false), false);
  }

  /**
   * @param clienteId restringe ao cliente (comprador); null traz o pedido de qualquer cliente
   */
  public PedidoView obter(String id, String clienteId) {
    // Comprador (clienteId != null) não vê o motivo exato da recusa do gateway.
    return PedidoView.of(buscar(id, clienteId), clienteId == null);
  }

  /** O pedido com a versão, para a linha do tempo (mesmas regras de acesso do {@link #obter}). */
  public PedidoDocument documento(String id, String clienteId) {
    return buscar(id, clienteId);
  }

  /**
   * Cancela por pedido do cliente. PENDENTE e CONFIRMADO podem ser cancelados; o estorno de um
   * pagamento já capturado fica com o pagamentos-service, que consome o pedido.cancelado.
   */
  @Transactional
  public PedidoView cancelar(String id, String clienteId) {
    PedidoDocument doc = buscar(id, clienteId);
    if (doc.getStatus() == StatusPedido.CANCELADO) {
      throw new PedidosExceptions.JaCancelado(id);
    }
    // Quem cancela entra no motivo: a auditoria distingue o cliente do gestor do tenant.
    return PedidoView.of(
        cancelarEPublicar(
            doc,
            clienteId == null
                ? MotivoCancelamento.CANCELADO_PELO_TENANT
                : MotivoCancelamento.SOLICITADO_PELO_CLIENTE),
        clienteId == null);
  }

  /**
   * pagamento.aprovado: confirma o pedido PENDENTE e publica pedido.confirmado. Pedido já em outro
   * estado (cancelado pelo cliente ou expirado) fica como está: o estorno é com Pagamentos, que
   * também recebe o pedido.cancelado (ADR-0006). Roda na transação do consumidor.
   */
  public void confirmarPagamento(String pedidoId, String pagamentoId) {
    PedidoDocument doc = pendente(pedidoId);
    if (doc == null) {
      return;
    }
    Instant agora = agora();
    doc.confirmar(pagamentoId, agora);
    PedidoDocument salvo = mongo.save(doc);
    outbox.append(
        PedidoConfirmado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId(salvo.getTenantId())
            .setOccurredAt(agora)
            .setPedidoId(salvo.getId())
            .setPagamentoId(pagamentoId)
            .setVersao(salvo.getVersion())
            .build(),
        salvo.getId());
  }

  /** pagamento.recusado: cancela o pedido PENDENTE com PAGAMENTO_RECUSADO e anota o motivo. */
  public void recusarPagamento(String pedidoId, String motivo) {
    PedidoDocument doc = pendente(pedidoId);
    if (doc != null) {
      doc.recusar(motivo, agora());
      cancelarEPublicar(doc, MotivoCancelamento.PAGAMENTO_RECUSADO);
    }
  }

  /**
   * pagamento.estornado: anota na linha do tempo que o valor voltou ao cliente. Não muda o status
   * (o pedido já está CANCELADO) nem publica evento. Roda na transação do consumidor.
   */
  public void registrarEstorno(String pedidoId, String pagamentoId) {
    PedidoDocument doc =
        mongo.findOne(
            TenantQueries.scoped(Criteria.where("_id").is(pedidoId)), PedidoDocument.class);
    if (doc != null && doc.estornar(pagamentoId, agora())) {
      mongo.save(doc);
    }
  }

  /**
   * Job de expiração: cancela com EXPIRADO o pedido que continua PENDENTE (sem resposta do
   * pagamento). Relê dentro da transação, então um pagamento que chegou no meio vence.
   */
  @Transactional
  public boolean expirar(String pedidoId) {
    PedidoDocument doc = pendente(pedidoId);
    if (doc == null) {
      return false;
    }
    cancelarEPublicar(doc, MotivoCancelamento.EXPIRADO);
    return true;
  }

  private PedidoDocument pendente(String pedidoId) {
    return mongo.findOne(
        TenantQueries.scoped(
            Criteria.where("_id").is(pedidoId).and("status").is(StatusPedido.PENDENTE)),
        PedidoDocument.class);
  }

  private PedidoDocument cancelarEPublicar(PedidoDocument doc, MotivoCancelamento motivo) {
    Instant agora = agora();
    doc.cancelar(motivo, agora);
    PedidoDocument salvo = mongo.save(doc);
    outbox.append(
        PedidoCancelado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId(salvo.getTenantId())
            .setOccurredAt(agora)
            .setPedidoId(salvo.getId())
            .setMotivo(
                br.dev.plataforma.contracts.pedidos.MotivoCancelamento.valueOf(
                    salvo.getMotivoCancelamento().name()))
            .setVersao(salvo.getVersion())
            .build(),
        salvo.getId());
    return salvo;
  }

  /**
   * Lista do mais recente para o mais antigo (criadoEm e, no empate, id). O cursor é o par do
   * último item da página anterior, em base64url (opaco para o cliente).
   *
   * @param clienteId restringe ao cliente; null traz todos os do tenant
   * @param status filtro de estado; null traz todos
   */
  public PedidoView.Pagina listar(
      String clienteId, StatusPedido status, String cursor, int limite) {
    if (limite < 1 || limite > MAX_PAGE) {
      throw new PedidosExceptions.RequisicaoInvalida(
          "limite deve ficar entre 1 e " + MAX_PAGE + ".");
    }
    List<Criteria> filtros = new ArrayList<>();
    if (clienteId != null) {
      filtros.add(Criteria.where("clienteId").is(clienteId));
    }
    if (status != null) {
      filtros.add(Criteria.where("status").is(status));
    }
    if (cursor != null && !cursor.isBlank()) {
      Cursor c = Cursor.decodificar(cursor);
      filtros.add(
          new Criteria()
              .orOperator(
                  Criteria.where("criadoEm").lt(c.criadoEm()),
                  Criteria.where("criadoEm").is(c.criadoEm()).and("_id").lt(c.id())));
    }
    Query query =
        TenantQueries.scoped(
                filtros.isEmpty() ? new Criteria() : new Criteria().andOperator(filtros))
            .with(Sort.by(Sort.Order.desc("criadoEm"), Sort.Order.desc("_id")))
            .limit(limite + 1);
    List<PedidoDocument> docs = mongo.find(query, PedidoDocument.class);
    boolean temMais = docs.size() > limite;
    List<PedidoDocument> pagina = docs.stream().limit(limite).toList();
    String proximo =
        temMais
            ? new Cursor(pagina.getLast().getCriadoEm(), pagina.getLast().getId()).codificar()
            : null;
    return new PedidoView.Pagina(
        pagina.stream().map(p -> PedidoView.of(p, clienteId == null)).toList(), proximo);
  }

  /**
   * Tenant suspenso não cria pedidos, mesmo que o gateway ainda não saiba da suspensão (ou alguém
   * chame o serviço sem passar por ele). Tenant ainda desconhecido passa: o tenant.criado pode
   * estar a caminho. Cancelar continua permitido: desfazer um pedido não cria obrigação nova.
   */
  private void exigirTenantAtivo() {
    TenantSituacao tenant = mongo.findOne(TenantQueries.scoped(), TenantSituacao.class);
    if (tenant != null && !tenant.isAtivo()) {
      throw new PedidosExceptions.TenantSuspenso();
    }
  }

  private PedidoDocument buscar(String id, String clienteId) {
    Criteria criteria = Criteria.where("_id").is(id);
    if (clienteId != null) {
      // Pedido de outro cliente responde 404, como se não existisse.
      criteria = criteria.and("clienteId").is(clienteId);
    }
    PedidoDocument doc = mongo.findOne(TenantQueries.scoped(criteria), PedidoDocument.class);
    if (doc == null) {
      throw new PedidosExceptions.NaoEncontrado(id);
    }
    return doc;
  }

  private void publicarCriado(PedidoDocument p, Instant agora) {
    outbox.append(
        PedidoCriado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId(p.getTenantId())
            .setOccurredAt(agora)
            .setPedidoId(p.getId())
            .setClienteId(p.getClienteId())
            .setItens(
                p.getItens().stream()
                    .map(
                        i ->
                            ItemPedido.newBuilder()
                                .setProdutoId(i.produtoId())
                                .setSku(i.sku())
                                .setQuantidade(i.quantidade())
                                .setPrecoUnitarioCentavos(i.precoUnitarioCentavos())
                                .build())
                    .toList())
            .setTotalCentavos(p.getTotalCentavos())
            .setMoeda(p.getMoeda())
            .setVersao(p.getVersion())
            .build(),
        p.getId());
  }

  private Instant agora() {
    return clock.instant().truncatedTo(ChronoUnit.MILLIS);
  }

  /** Hash do que define o pedido: produtos e quantidades, na ordem enviada. */
  static String hash(NovoPedido req) {
    StringBuilder canonico = new StringBuilder();
    for (NovoPedido.Item item : req.itens()) {
      canonico.append(item.produtoId()).append('\t').append(item.quantidade()).append('\n');
    }
    try {
      byte[] digest =
          MessageDigest.getInstance("SHA-256")
              .digest(canonico.toString().getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 indisponível", e);
    }
  }

  /** Posição na listagem: criadoEm e id do último pedido da página. */
  record Cursor(Instant criadoEm, String id) {

    String codificar() {
      String texto = criadoEm.toEpochMilli() + "|" + id;
      return Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString(texto.getBytes(StandardCharsets.UTF_8));
    }

    static Cursor decodificar(String cursor) {
      try {
        String texto = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
        int sep = texto.indexOf('|');
        return new Cursor(
            Instant.ofEpochMilli(Long.parseLong(texto.substring(0, sep))),
            texto.substring(sep + 1));
      } catch (IllegalArgumentException | IndexOutOfBoundsException e) {
        throw new PedidosExceptions.RequisicaoInvalida("cursor inválido.");
      }
    }
  }
}
