package br.dev.plataforma.spring;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.contracts.tenants.TenantCriado;
import br.dev.plataforma.core.TenantId;
import br.dev.plataforma.spring.idempotency.IdempotencyIndexes;
import br.dev.plataforma.spring.idempotency.IdempotentConsumer;
import br.dev.plataforma.spring.idempotency.ProcessedEvent;
import br.dev.plataforma.spring.outbox.AvroCodec;
import br.dev.plataforma.spring.outbox.EventPublisher;
import br.dev.plataforma.spring.outbox.Outbox;
import br.dev.plataforma.spring.outbox.OutboxMessage;
import br.dev.plataforma.spring.outbox.OutboxRelay;
import br.dev.plataforma.spring.outbox.RelayLease;
import br.dev.plataforma.spring.tenancy.CrossTenantAccessException;
import br.dev.plataforma.spring.tenancy.MissingTenantException;
import br.dev.plataforma.spring.tenancy.TenantContext;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.pulsar.client.admin.PulsarAdmin;
import org.apache.pulsar.client.api.Consumer;
import org.apache.pulsar.client.api.Message;
import org.apache.pulsar.client.api.PulsarClient;
import org.apache.pulsar.client.api.Schema;
import org.apache.pulsar.client.api.SubscriptionInitialPosition;
import org.apache.pulsar.common.policies.data.TenantInfo;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.MongoDBContainer;
import org.testcontainers.containers.PulsarContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/** A biblioteca inteira contra MongoDB (replica set) e Pulsar reais. */
@Testcontainers
@SpringBootTest(
    classes = TestApp.class,
    webEnvironment = SpringBootTest.WebEnvironment.NONE,
    properties = {
      "plataforma.outbox.interval=1h", // o teste dispara o relay à mão
      "plataforma.events.receiver-queue-size=25"
    })
class PlatformSpringIT {

  static final TenantId ACME = new TenantId("acme");

  @Container static final MongoDBContainer MONGO = new MongoDBContainer("mongo:8.0");

  @Container
  static final PulsarContainer PULSAR =
      new PulsarContainer(DockerImageName.parse("apachepulsar/pulsar:4.0.7"));

  @DynamicPropertySource
  static void propriedades(DynamicPropertyRegistry registry) {
    registry.add("spring.data.mongodb.uri", () -> MONGO.getReplicaSetUrl("plataforma"));
    registry.add("spring.pulsar.client.service-url", PULSAR::getPulsarBrokerUrl);
    registry.add("spring.pulsar.admin.service-url", PULSAR::getHttpServiceUrl);
  }

  @BeforeAll
  static void criarNamespace() throws Exception {
    try (PulsarAdmin admin =
        PulsarAdmin.builder().serviceHttpUrl(PULSAR.getHttpServiceUrl()).build()) {
      admin
          .tenants()
          .createTenant(
              "plataforma",
              TenantInfo.builder().allowedClusters(java.util.Set.of("standalone")).build());
      admin.namespaces().createNamespace("plataforma/tenants");
    }
  }

  @Autowired MongoTemplate mongo;
  @Autowired Outbox outbox;
  @Autowired OutboxRelay relay;
  @Autowired IdempotentConsumer idempotent;
  @Autowired br.dev.plataforma.spring.events.EventDecoder decoder;
  @Autowired PulsarClient pulsar;
  @Autowired PlatformTransactionManager txManager;
  @Autowired br.dev.plataforma.spring.events.EventSubscriber subscriber;

  @Test
  void filaDoConsumidorVemDaConfiguracao() {
    // Pequena em quem escala pelo backlog (KEDA, ADR-0016): o backlog fica no broker.
    assertThat(subscriber.receiverQueueSize()).isEqualTo(25);
  }

  TransactionTemplate tx;

  @BeforeEach
  void limpar() {
    tx = new TransactionTemplate(txManager);
    mongo.remove(new Query(), OutboxMessage.class);
    mongo.remove(new Query(), ProcessedEvent.class);
    mongo.remove(new Query(), Nota.class);
  }

  private static TenantCriado evento(String tenant) {
    return TenantCriado.newBuilder()
        .setEventId(UUID.randomUUID())
        .setTenantId(tenant)
        .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
        .setTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
        .setNome("ACME")
        .setPlano(Plano.PROFISSIONAL)
        .setNivelIsolamento(NivelIsolamento.POOL)
        .build();
  }

  @Test
  void outboxExigeTransacao() {
    assertThatThrownBy(() -> outbox.append(evento("acme"), "acme"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("transação");
  }

  @Test
  void rollbackDescartaEstadoEEventoJuntos() {
    assertThatThrownBy(
            () ->
                tx.executeWithoutResult(
                    s -> {
                      TenantContext.runAs(
                          new TenantId("acme"), () -> mongo.insert(new Nota("n1", null, "x")));
                      outbox.append(evento("acme"), "acme");
                      throw new IllegalStateException("regra de negócio falhou");
                    }))
        .hasMessage("regra de negócio falhou");

    assertThat(mongo.count(new Query(), OutboxMessage.class)).isZero();
    assertThat(mongo.count(new Query(), Nota.class)).isZero();
  }

  @Test
  void relayPublicaNoPulsarComChaveEPropriedades() throws Exception {
    TenantCriado evento = evento("acme");
    tx.executeWithoutResult(s -> outbox.append(evento, "acme"));

    try (Consumer<byte[]> consumer =
        pulsar
            .newConsumer(Schema.BYTES)
            .topic("persistent://plataforma/tenants/tenant.criado.v1")
            .subscriptionName("teste-" + UUID.randomUUID())
            .subscriptionInitialPosition(SubscriptionInitialPosition.Earliest)
            .subscribe()) {

      assertThat(relay.publishPending()).isEqualTo(1);

      Message<byte[]> msg = consumer.receive(20, TimeUnit.SECONDS);
      assertThat(msg).isNotNull();
      assertThat(msg.getKey()).isEqualTo("acme:acme");
      assertThat(msg.getProperty("eventId")).isEqualTo(evento.getEventId().toString());
      assertThat(msg.getProperty("tenantId")).isEqualTo("acme");
      assertThat(msg.getProperty("event")).isEqualTo("tenant.criado");
      assertThat(msg.getProperty("traceparent")).startsWith("00-");
      assertThat(msg.getEventTime()).isEqualTo(evento.getOccurredAt().toEpochMilli());
      assertThat(AvroCodec.decode(msg.getValue(), TenantCriado.class)).isEqualTo(evento);
      // O caminho de um consumidor real: schema do escritor vindo do Schema Registry
      assertThat(decoder.decode(msg, TenantCriado.class)).isEqualTo(evento);
      consumer.acknowledge(msg);
    }

    OutboxMessage gravada = mongo.findById(evento.getEventId().toString(), OutboxMessage.class);
    assertThat(gravada.publishedAt()).isNotNull();
    assertThat(gravada.schema()).isEqualTo(TenantCriado.getClassSchema().toString());
    assertThat(relay.publishPending()).as("nada mais pendente").isZero();
  }

  @Test
  void falhaNaPublicacaoParaOLoteERegistraTentativa() {
    tx.executeWithoutResult(
        s -> {
          outbox.append(evento("acme"), "acme");
          outbox.append(evento("globex"), "globex");
        });
    AtomicInteger chamadas = new AtomicInteger();
    EventPublisher quebrado =
        m -> {
          chamadas.incrementAndGet();
          throw new java.io.IOException("broker fora do ar");
        };

    int publicadas = new OutboxRelay(mongo, quebrado, Clock.systemUTC(), 10, null).publishPending();

    assertThat(publicadas).isZero();
    assertThat(chamadas).hasValue(1); // não pula para a próxima: preserva a ordem
    List<OutboxMessage> todas = mongo.findAll(OutboxMessage.class);
    assertThat(todas).extracting(OutboxMessage::attempts).containsExactlyInAnyOrder(1, 0);
    assertThat(todas).anyMatch(m -> "IOException".equals(m.lastError()));
  }

  @Test
  void outboxDeUmServicoRecusaEventoDeOutroProdutor() {
    Outbox doPedidos = new Outbox(mongo, EventCatalog.defaultCatalog(), "pedidos");

    assertThatThrownBy(() -> tx.executeWithoutResult(s -> doPedidos.append(evento("acme"), "acme")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("produtor é 'tenants'");
    assertThat(mongo.count(new Query(), OutboxMessage.class)).isZero();
  }

  @Test
  void runCycleNuncaPropagaExcecao() {
    OutboxRelay relayQuebrado =
        new OutboxRelay(null, m -> {}, Clock.systemUTC(), 10, null); // mongo nulo: NPE no ciclo
    relayQuebrado.runCycle();
  }

  @Test
  void consumidorIdempotenteProcessaUmaVez() {
    List<String> efeitos = new ArrayList<>();
    Runnable efeito = () -> efeitos.add("x");

    Boolean primeira = tx.execute(s -> idempotent.processOnce(ACME, "catalogo", "e1", efeito));
    Boolean repetida = tx.execute(s -> idempotent.processOnce(ACME, "catalogo", "e1", efeito));
    Boolean outroConsumidor =
        tx.execute(s -> idempotent.processOnce(ACME, "pedidos", "e1", efeito));

    assertThat(primeira).isTrue();
    assertThat(repetida).isFalse();
    assertThat(outroConsumidor).isTrue();
    assertThat(efeitos).hasSize(2);
  }

  @Test
  void falhaNoEfeitoDesfazORegistroEAReentregaProcessa() {
    assertThatThrownBy(
            () ->
                tx.executeWithoutResult(
                    s ->
                        idempotent.processOnce(
                            ACME,
                            "catalogo",
                            "e2",
                            () -> {
                              throw new IllegalStateException("efeito falhou");
                            })))
        .hasMessage("efeito falhou");

    Boolean reentrega = tx.execute(s -> idempotent.processOnce(ACME, "catalogo", "e2", () -> {}));
    assertThat(reentrega).isTrue();
  }

  @Test
  void consumidorIdempotenteExigeTransacao() {
    assertThatThrownBy(() -> idempotent.processOnce(ACME, "c", "e", () -> {}))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void guardaPreencheTenantDoContextoERecusaOutroTenant() throws Exception {
    TenantContext.runAs(new TenantId("acme"), () -> mongo.insert(new Nota("n1", null, "a")));
    assertThat(mongo.findById("n1", Nota.class).getTenantId()).isEqualTo("acme");

    assertThatThrownBy(
            () ->
                TenantContext.runAs(
                    new TenantId("acme"), () -> mongo.insert(new Nota("n2", "globex", "b"))))
        .isInstanceOf(CrossTenantAccessException.class);
    assertThatThrownBy(() -> mongo.insert(new Nota("n3", null, "c")))
        .isInstanceOf(MissingTenantException.class);

    // Fora de requisição (ex.: job), um documento com tenant explícito é aceito
    mongo.insert(new Nota("n4", "globex", "d"));
    assertThat(mongo.findById("n4", Nota.class).getTenantId()).isEqualTo("globex");

    // Na leitura também: findById sem filtro de tenant não vaza documento de outro tenant
    assertThatThrownBy(
            () ->
                TenantContext.callAs(
                    new TenantId("acme"), null, () -> mongo.findById("n4", Nota.class)))
        .isInstanceOf(CrossTenantAccessException.class);
    assertThat(
            TenantContext.callAs(new TenantId("acme"), null, () -> mongo.findById("n1", Nota.class))
                .texto)
        .isEqualTo("a");
  }

  @Test
  void indicesDeDeduplicacaoEOutboxExistem() {
    assertThat(mongo.indexOps(ProcessedEvent.class).getIndexInfo())
        .anySatisfy(i -> assertThat(i.getName()).isEqualTo("uk_tenant_consumer_event"))
        .anySatisfy(i -> assertThat(i.getName()).isEqualTo("ttl_processed"));
    assertThat(mongo.indexOps(OutboxMessage.class).getIndexInfo())
        .anySatisfy(i -> assertThat(i.getName()).isEqualTo("ix_pending_seq"));
  }

  @Test
  void mudarARetencaoRecriaOIndiceTtlEmVezDeImpedirASubida() {
    IdempotencyIndexes.ensure(mongo, java.time.Duration.ofDays(3));

    assertThat(mongo.indexOps(OutboxMessage.class).getIndexInfo())
        .filteredOn(i -> i.getName().equals("ttl_published"))
        .singleElement()
        .satisfies(i -> assertThat(i.getExpireAfter()).hasValue(java.time.Duration.ofDays(3)));
    IdempotencyIndexes.ensure(mongo, java.time.Duration.ofDays(7));
  }

  @Test
  void eventSubscriberConsomeComIdempotenciaETentaDeNovoAposFalha() throws Exception {
    var subscriber =
        new br.dev.plataforma.spring.events.EventSubscriber(
            pulsar,
            EventCatalog.defaultCatalog(),
            decoder,
            idempotent,
            tx,
            "teste-" + UUID.randomUUID().toString().substring(0, 8),
            5);
    // Métricas e o traceparent que chega ao consumidor (o tracing de verdade fica com o serviço).
    var metricas = new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
    var observacoes = io.micrometer.observation.ObservationRegistry.create();
    observacoes
        .observationConfig()
        .observationHandler(
            new io.micrometer.core.instrument.observation.DefaultMeterObservationHandler(metricas));
    List<String> traceparents = new java.util.concurrent.CopyOnWriteArrayList<>();
    observacoes
        .observationConfig()
        .observationHandler(
            new io.micrometer.observation.ObservationHandler<
                io.micrometer.observation.transport.ReceiverContext<Object>>() {
              @Override
              public void onStart(io.micrometer.observation.transport.ReceiverContext<Object> ctx) {
                traceparents.add(ctx.getGetter().get(ctx.getCarrier(), "traceparent"));
              }

              @Override
              public boolean supportsContext(io.micrometer.observation.Observation.Context c) {
                return c instanceof io.micrometer.observation.transport.ReceiverContext;
              }
            });
    subscriber.setObservationRegistry(observacoes);
    java.util.concurrent.atomic.AtomicInteger tentativas =
        new java.util.concurrent.atomic.AtomicInteger();
    subscriber.on(
        TenantCriado.class,
        "notas",
        e -> {
          // A primeira tentativa falha depois de gravar: o rollback desfaz a nota e o registro.
          mongo.insert(new Nota(e.getEventId().toString(), null, e.getNome().toString()));
          if (tentativas.incrementAndGet() == 1) {
            throw new IllegalStateException("falha temporária");
          }
        });
    subscriber.start();
    try {
      assertThat(subscriber.isRunning()).isTrue();
      TenantCriado evento = evento("acme");
      tx.executeWithoutResult(s -> outbox.append(evento, "acme"));
      relay.runCycle();

      org.awaitility.Awaitility.await()
          .atMost(java.time.Duration.ofSeconds(30))
          .until(() -> mongo.count(new Query(), Nota.class) == 1);
      Nota nota = mongo.findById(evento.getEventId().toString(), Nota.class);
      assertThat(nota.getTenantId()).isEqualTo("acme"); // tenant do evento no contexto
      assertThat(tentativas.get()).isEqualTo(2);
      assertThat(mongo.count(new Query(), ProcessedEvent.class)).isEqualTo(1);
      org.awaitility.Awaitility.await()
          .atMost(java.time.Duration.ofSeconds(5))
          .untilAsserted(
              () -> {
                assertThat(
                        metricas
                            .get(br.dev.plataforma.spring.events.EventSubscriber.OBSERVATION)
                            .tags("assinatura", "notas", "evento", "tenant.criado")
                            .tag("resultado", "falha")
                            .timer()
                            .count())
                    .isEqualTo(1);
                assertThat(
                        metricas
                            .get(br.dev.plataforma.spring.events.EventSubscriber.OBSERVATION)
                            .tag("resultado", "processado")
                            .timer()
                            .count())
                    .isEqualTo(1);
              });
      assertThat(traceparents).contains(evento.getTraceparent().toString());
    } finally {
      subscriber.stop();
    }
    assertThat(subscriber.isRunning()).isFalse();
  }

  @Test
  void outboxGravaOTraceAtualQuandoOEventoNaoTraz() {
    String trace = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    Outbox comTrace = new Outbox(mongo, EventCatalog.defaultCatalog(), "tenants", () -> trace);
    TenantCriado semTrace = evento("acme");
    semTrace.setTraceparent(null);
    TenantCriado comProprio = evento("globex");

    tx.executeWithoutResult(
        s -> {
          comTrace.append(semTrace, "acme");
          comTrace.append(comProprio, "globex");
        });

    assertThat(mongo.findById(semTrace.getEventId().toString(), OutboxMessage.class).traceparent())
        .isEqualTo(trace);
    // O payload leva o mesmo trace que a propriedade da mensagem.
    OutboxMessage gravada = mongo.findById(semTrace.getEventId().toString(), OutboxMessage.class);
    assertThat(AvroCodec.decode(gravada.payload(), TenantCriado.class).getTraceparent().toString())
        .isEqualTo(trace);
    assertThat(
            mongo.findById(comProprio.getEventId().toString(), OutboxMessage.class).traceparent())
        .isEqualTo(comProprio.getTraceparent().toString());
  }

  @Test
  void leaseDoRelayDeixaUmaReplicaPublicarPorVez() throws Exception {
    var colecao =
        mongo.getCollection("lease_teste_" + UUID.randomUUID().toString().substring(0, 8));
    var ttl = java.time.Duration.ofMillis(600);
    RelayLease a = new RelayLease(colecao, Clock.systemUTC(), ttl);
    RelayLease b = new RelayLease(colecao, Clock.systemUTC(), ttl);

    assertThat(a.tryAcquire()).isTrue();
    assertThat(a.isLeader()).isTrue();
    assertThat(b.tryAcquire()).isFalse();
    assertThat(b.isLeader()).isFalse();
    // b, sem lease, não publica nada.
    tx.executeWithoutResult(s -> outbox.append(evento("acme"), "acme"));
    AtomicInteger publicadasPorB = new AtomicInteger();
    var relayB =
        new OutboxRelay(mongo, m -> publicadasPorB.incrementAndGet(), Clock.systemUTC(), 10, b);
    assertThat(relayB.publishPending()).isZero();
    assertThat(relayB.isLeader()).isFalse();

    // a para de renovar (caiu): depois da validade, b assume e a perde.
    Thread.sleep(ttl.toMillis() + 100);
    assertThat(b.tryAcquire()).isTrue();
    assertThat(relayB.publishPending()).isEqualTo(1);
    assertThat(relayB.publishedCount()).isEqualTo(1);
    assertThat(a.tryAcquire()).isFalse();
    assertThat(a.isLeader()).isFalse();

    // Desligamento de b solta o lease na hora, e b nunca mais assume.
    relayB.close();
    assertThat(b.tryAcquire()).isFalse();
    assertThat(relayB.isLeader()).isFalse();
    assertThat(a.tryAcquire()).isTrue();
    a.release();
    a.release(); // sem lease: nada a fazer

    // Documento apagado à mão: a próxima réplica recria e assume, sem reiniciar.
    RelayLease c = new RelayLease(colecao, Clock.systemUTC(), ttl);
    assertThat(c.tryAcquire()).isTrue();
    colecao.deleteMany(new org.bson.Document());
    Thread.sleep(ttl.toMillis() + 100);
    assertThat(c.tryAcquire()).isTrue();
    assertThat(colecao.countDocuments()).isEqualTo(1);
  }

  @Test
  void metricasDoOutboxContamPendentesEAtraso() {
    tx.executeWithoutResult(
        s -> {
          outbox.append(evento("acme"), "acme");
          outbox.append(evento("globex"), "globex");
        });
    var registro = new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
    AtomicInteger falhar = new AtomicInteger(1);
    var relayLocal =
        new OutboxRelay(
            mongo,
            m -> {
              if (falhar.getAndDecrement() > 0) {
                throw new java.io.IOException("fora do ar");
              }
            },
            Clock.systemUTC(),
            10,
            null);
    new br.dev.plataforma.spring.observability.PlatformMetrics(
            mongo, relayLocal, null, null, Clock.systemUTC())
        .bindTo(registro);

    assertThat(registro.get("plataforma.outbox.pendentes").gauge().value()).isEqualTo(2);
    assertThat(registro.get("plataforma.outbox.atraso").gauge().value()).isGreaterThanOrEqualTo(0);
    assertThat(registro.get("plataforma.outbox.relay.lider").gauge().value()).isEqualTo(1);

    relayLocal.publishPending(); // falha no primeiro
    relayLocal.publishPending(); // publica os dois
    assertThat(registro.get("plataforma.outbox.falhas").functionCounter().count()).isEqualTo(1);
    assertThat(registro.get("plataforma.outbox.publicados").functionCounter().count()).isEqualTo(2);
    // A contagem fica em cache por alguns segundos: não vai ao MongoDB a cada raspagem.
    assertThat(registro.get("plataforma.outbox.pendentes").gauge().value()).isEqualTo(2);
  }

  @Test
  void eventSubscriberExigeNomeDoServico() {
    var subscriber =
        new br.dev.plataforma.spring.events.EventSubscriber(
            pulsar, EventCatalog.defaultCatalog(), decoder, idempotent, tx, null, 5);
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> subscriber.on(TenantCriado.class, "x", e -> {}))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("plataforma.service");
  }
}
