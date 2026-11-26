package br.dev.plataforma.pedidos;

import br.dev.plataforma.core.TenantId;
import br.dev.plataforma.spring.tenancy.TenantContext;
import br.dev.plataforma.spring.tenancy.TenantQueries;
import com.mongodb.client.model.changestream.ChangeStreamDocument;
import com.mongodb.client.model.changestream.FullDocument;
import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;
import org.bson.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.context.SmartLifecycle;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.aggregation.Aggregation;
import org.springframework.data.mongodb.core.messaging.ChangeStreamRequest;
import org.springframework.data.mongodb.core.messaging.DefaultMessageListenerContainer;
import org.springframework.data.mongodb.core.messaging.MessageListener;
import org.springframework.data.mongodb.core.messaging.MessageListenerContainer;
import org.springframework.data.mongodb.core.messaging.Subscription;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Linha do tempo do pedido em tempo real (ADR-0013). Cada réplica abre <b>um</b> change stream na
 * coleção {@code pedidos} e repassa a mudança às conexões SSE abertas nela para aquele pedido. Como
 * o change stream vem do banco, a mudança feita por outra réplica (ou pelo consumidor de eventos)
 * também chega. A cada batimento (15 s) a conexão recebe um {@code : ping} e o pedido é relido: se
 * o change stream caiu, a mudança chega com atraso, mas chega; o change stream é reaberto.
 *
 * <p>O envio nunca bloqueia quem publica: cada conexão guarda só o estado mais novo e o escreve
 * numa thread virtual própria. Um cliente lento atrasa só a si mesmo.
 */
@Component
public class LinhaDoTempo implements SmartLifecycle, HealthIndicator {

  private static final Logger LOG = LoggerFactory.getLogger(LinhaDoTempo.class);
  static final String EVENTO = "pedido";

  /** Muitas conexões abertas (por tenant ou na réplica): 429. */
  public static class MuitasConexoes extends RuntimeException {
    MuitasConexoes(String detalhe) {
      super(detalhe);
    }
  }

  /** A réplica está subindo ou desligando: 503, o cliente reconecta em outra. */
  public static class Indisponivel extends RuntimeException {
    Indisponivel() {
      super("A linha do tempo está indisponível nesta instância. Tente de novo em instantes.");
    }
  }

  /** Uma conexão aberta. Envio coalescido: só o pedido mais novo espera na vaga. */
  final class Assinatura {
    final SseEmitter emitter;
    final String tenantId;
    final String pedidoId;
    final boolean veMotivoRecusa;
    volatile long versao = -1;
    private final AtomicReference<PedidoDocument> pendente = new AtomicReference<>();
    private final AtomicBoolean ping = new AtomicBoolean();
    private final AtomicBoolean drenando = new AtomicBoolean();
    private final ReentrantLock escrita = new ReentrantLock();
    private volatile boolean encerrada;

    Assinatura(SseEmitter emitter, String tenantId, String pedidoId, boolean veMotivoRecusa) {
      this.emitter = emitter;
      this.tenantId = tenantId;
      this.pedidoId = pedidoId;
      this.veMotivoRecusa = veMotivoRecusa;
    }

    /** Agenda o envio do pedido, se for mais novo do que o já enviado. Não bloqueia. */
    void oferecer(PedidoDocument doc) {
      long v = versaoDe(doc);
      if (v <= versao) {
        return;
      }
      pendente.accumulateAndGet(
          doc, (atual, novo) -> atual != null && versaoDe(atual) >= versaoDe(novo) ? atual : novo);
      drenar();
    }

    void pingar() {
      ping.set(true);
      drenar();
    }

    private void drenar() {
      if (encerrada || !drenando.compareAndSet(false, true)) {
        return;
      }
      Thread.ofVirtual().name("linha-do-tempo-envio").start(this::escrever);
    }

    private void escrever() {
      escrita.lock();
      try {
        while (!encerrada) {
          PedidoDocument doc = pendente.getAndSet(null);
          boolean comPing = ping.getAndSet(false);
          if (doc == null && !comPing) {
            break;
          }
          if (doc != null && versaoDe(doc) > versao) {
            emitter.send(
                SseEmitter.event()
                    .name(EVENTO)
                    .id(Long.toString(versaoDe(doc)))
                    .data(PedidoView.of(doc, veMotivoRecusa), MediaType.APPLICATION_JSON));
            versao = versaoDe(doc);
          }
          if (comPing) {
            emitter.send(SseEmitter.event().comment("ping"));
          }
        }
      } catch (IOException | IllegalStateException e) {
        // Cliente foi embora: sai da lista agora (o Spring ignora complete depois de falha de
        // envio).
        encerrar();
      } catch (RuntimeException e) {
        // Ex.: falha ao serializar o pedido. Encerra para não ocupar a vaga do tenant até o
        // timeout.
        LOG.warn("Envio da linha do tempo do pedido {} falhou", pedidoId, e);
        encerrar();
        emitter.completeWithError(e);
      } finally {
        escrita.unlock();
        drenando.set(false);
      }
      if (!encerrada && (pendente.get() != null || ping.get())) {
        drenar(); // chegou algo enquanto liberava a vaga
      }
    }

    void encerrar() {
      if (!encerrada) {
        encerrada = true;
        remover(chave(tenantId, pedidoId), this);
      }
    }
  }

  private final MongoTemplate mongo;
  private final Duration timeout;
  private final Duration batimento;
  private final int maxPorTenant;
  private final int maxPorReplica;
  private final Map<String, Set<Assinatura>> assinaturas = new ConcurrentHashMap<>();
  private final Map<String, AtomicInteger> porTenant = new ConcurrentHashMap<>();
  private final AtomicInteger total = new AtomicInteger();
  private ScheduledExecutorService agenda;
  private MessageListenerContainer container;
  private volatile Subscription changeStream;
  private volatile boolean rodando;

  public LinhaDoTempo(
      MongoTemplate mongo,
      @Value("${plataforma.pedidos.linha-do-tempo.timeout:PT5M}") Duration timeout,
      @Value("${plataforma.pedidos.linha-do-tempo.batimento:PT15S}") Duration batimento,
      @Value("${plataforma.pedidos.linha-do-tempo.max-por-tenant:50}") int maxPorTenant,
      @Value("${plataforma.pedidos.linha-do-tempo.max-por-replica:500}") int maxPorReplica) {
    this.mongo = mongo;
    this.timeout = timeout;
    this.batimento = batimento;
    this.maxPorTenant = maxPorTenant;
    this.maxPorReplica = maxPorReplica;
  }

  /**
   * Abre o fluxo de um pedido. Registra a conexão <b>antes</b> de ler o pedido: uma mudança que
   * aconteça entre a leitura e o registro não se perde (a versão descarta a duplicata). A leitura
   * aplica as regras de acesso (404 para pedido de outro cliente) e, se falhar, desfaz o registro.
   *
   * @param veMotivoRecusa false para o comprador: o motivo exato da recusa é do tenant (Dia 7)
   */
  public SseEmitter abrir(
      String tenantId, String pedidoId, boolean veMotivoRecusa, Supplier<PedidoDocument> leitura) {
    if (!rodando) {
      throw new Indisponivel();
    }
    reservar(tenantId);
    SseEmitter emitter = new SseEmitter(timeout.toMillis());
    Assinatura a = new Assinatura(emitter, tenantId, pedidoId, veMotivoRecusa);
    assinaturas
        .computeIfAbsent(chave(tenantId, pedidoId), k -> ConcurrentHashMap.newKeySet())
        .add(a);
    PedidoDocument atual;
    try {
      atual = leitura.get();
    } catch (RuntimeException e) {
      a.encerrar();
      throw e;
    }
    emitter.onCompletion(a::encerrar);
    emitter.onTimeout(
        () -> {
          a.encerrar();
          emitter.complete();
        });
    emitter.onError(e -> a.encerrar());
    a.oferecer(atual);
    return emitter;
  }

  private void reservar(String tenantId) {
    if (total.incrementAndGet() > maxPorReplica) {
      total.decrementAndGet();
      throw new MuitasConexoes("Muitas linhas do tempo abertas nesta instância; tente de novo.");
    }
    boolean[] cheio = {false};
    // Checagem e incremento atômicos com a remoção (que tira o contador do mapa ao chegar a zero).
    porTenant.compute(
        tenantId,
        (k, n) -> {
          int atual = n == null ? 0 : n.get();
          if (atual >= maxPorTenant) {
            cheio[0] = true;
            return n;
          }
          return new AtomicInteger(atual + 1);
        });
    if (cheio[0]) {
      total.decrementAndGet();
      throw new MuitasConexoes(
          "O tenant já tem " + maxPorTenant + " linhas do tempo abertas; feche alguma.");
    }
  }

  /** Mudança de um pedido (change stream ou releitura): manda para quem acompanha. */
  void publicar(PedidoDocument doc) {
    Set<Assinatura> lista = assinaturas.get(chave(doc.getTenantId(), doc.getId()));
    if (lista != null) {
      lista.forEach(a -> a.oferecer(doc));
    }
  }

  /** Quantas conexões estão abertas (testes e saúde). */
  int abertas() {
    return total.get();
  }

  /** Batimento: comentário para manter a conexão viva e releitura de quem ficou para trás. */
  void bater() {
    for (Map.Entry<String, Set<Assinatura>> e : assinaturas.entrySet()) {
      try {
        Assinatura qualquer = e.getValue().stream().findFirst().orElse(null);
        if (qualquer == null) {
          continue;
        }
        PedidoDocument doc = reler(qualquer.tenantId, qualquer.pedidoId);
        for (Assinatura a : e.getValue()) {
          if (doc != null) {
            a.oferecer(doc);
          }
          a.pingar();
        }
      } catch (RuntimeException ex) {
        LOG.debug("Batimento de {} falhou: {}", e.getKey(), ex.toString());
      }
    }
    if (rodando && (changeStream == null || !changeStream.isActive())) {
      abrirChangeStream(); // caiu (eleição, restart do MongoDB): reabre
    }
  }

  private PedidoDocument reler(String tenantId, String pedidoId) {
    try {
      return TenantContext.callAsUnchecked(
          TenantId.of(tenantId),
          () ->
              mongo.findOne(
                  TenantQueries.scoped(Criteria.where("_id").is(pedidoId)), PedidoDocument.class));
    } catch (RuntimeException e) {
      LOG.debug("Releitura do pedido {} falhou: {}", pedidoId, e.toString());
      return null;
    }
  }

  private void remover(String chave, Assinatura a) {
    boolean[] removida = {false};
    assinaturas.computeIfPresent(
        chave,
        (k, lista) -> {
          removida[0] = lista.remove(a);
          return lista.isEmpty() ? null : lista;
        });
    if (removida[0]) {
      total.decrementAndGet();
      porTenant.computeIfPresent(
          a.tenantId, (k, n) -> n.get() <= 1 ? null : new AtomicInteger(n.get() - 1));
    }
  }

  static String chave(String tenantId, String pedidoId) {
    return tenantId + ":" + pedidoId;
  }

  static long versaoDe(PedidoDocument doc) {
    return doc.getVersion() == null ? 0 : doc.getVersion();
  }

  private synchronized void abrirChangeStream() {
    if (container == null || (changeStream != null && changeStream.isActive())) {
      return;
    }
    if (changeStream != null) {
      container.remove(changeStream);
    }
    MessageListener<ChangeStreamDocument<Document>, PedidoDocument> ouvinte =
        message -> {
          if (assinaturas.isEmpty()) {
            return; // ninguém acompanha nada: nem converte o documento
          }
          Document bruto = message.getRaw() == null ? null : message.getRaw().getFullDocument();
          if (bruto == null
              || !assinaturas.containsKey(
                  chave(bruto.getString("tenantId"), String.valueOf(bruto.get("_id"))))) {
            return;
          }
          PedidoDocument doc = message.getBody();
          if (doc != null) {
            publicar(doc);
          }
        };
    ChangeStreamRequest<PedidoDocument> request =
        ChangeStreamRequest.builder(ouvinte)
            .collection(mongo.getCollectionName(PedidoDocument.class))
            .filter(
                Aggregation.newAggregation(
                    Aggregation.match(
                        Criteria.where("operationType").in("insert", "update", "replace"))))
            .fullDocumentLookup(FullDocument.UPDATE_LOOKUP)
            .build();
    changeStream =
        container.register(
            request,
            PedidoDocument.class,
            e ->
                LOG.warn(
                    "Change stream da linha do tempo caiu; reabre no batimento: {}", e.toString()));
  }

  @Override
  public Health health() {
    boolean ativo = changeStream != null && changeStream.isActive();
    // Sem change stream a linha do tempo ainda funciona pelo batimento: avisa sem derrubar.
    return Health.up()
        .withDetail("changeStream", ativo ? "ativo" : "reabrindo")
        .withDetail("conexoes", total.get())
        .build();
  }

  @Override
  public void start() {
    container = new DefaultMessageListenerContainer(mongo);
    container.start();
    abrirChangeStream();
    agenda =
        Executors.newSingleThreadScheduledExecutor(
            Thread.ofVirtual().name("linha-do-tempo-batimento").factory());
    agenda.scheduleWithFixedDelay(
        this::baterComSeguranca, batimento.toMillis(), batimento.toMillis(), TimeUnit.MILLISECONDS);
    rodando = true;
  }

  private void baterComSeguranca() {
    try {
      bater();
    } catch (RuntimeException e) {
      LOG.warn("Batimento da linha do tempo falhou", e);
    }
  }

  /**
   * Para antes do desligamento gracioso do servidor web (fase maior): as conexões abertas são
   * encerradas com {@code complete()} e o navegador reconecta em outra réplica; novas aberturas
   * recebem 503 até a réplica sair.
   */
  @Override
  public void stop() {
    rodando = false;
    if (agenda != null) {
      agenda.shutdownNow();
    }
    if (container != null) {
      container.stop();
    }
    changeStream = null;
    assinaturas.values().forEach(lista -> lista.forEach(a -> a.emitter.complete()));
    assinaturas.clear();
    porTenant.clear();
    total.set(0);
  }

  @Override
  public boolean isRunning() {
    return rodando;
  }
}
