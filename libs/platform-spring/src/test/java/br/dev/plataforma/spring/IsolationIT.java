package br.dev.plataforma.spring;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.contracts.tenants.TenantAlterado;
import br.dev.plataforma.core.IsolationLevel;
import br.dev.plataforma.core.TenantId;
import br.dev.plataforma.spring.isolation.TenantMigratingException;
import br.dev.plataforma.spring.isolation.TenantPlacement;
import br.dev.plataforma.spring.isolation.TenantPlacements;
import br.dev.plataforma.spring.outbox.Outbox;
import br.dev.plataforma.spring.outbox.OutboxMessage;
import br.dev.plataforma.spring.tenancy.TenantContext;
import com.mongodb.client.MongoClient;
import com.mongodb.client.model.Filters;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.apache.pulsar.client.admin.PulsarAdmin;
import org.apache.pulsar.common.policies.data.TenantInfo;
import org.bson.Document;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.mongodb.MongoDatabaseFactory;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Index;
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

/** Database por tenant (ADR-0014): roteamento, migração e consumo de tenant.alterado. */
@Testcontainers
@SpringBootTest(
    classes = TestApp.class,
    webEnvironment = SpringBootTest.WebEnvironment.NONE,
    properties = {
      "plataforma.service=tenants",
      "plataforma.isolation.enabled=true",
      "plataforma.isolation.collections=notas",
      "plataforma.isolation.refresh=PT0.2S",
      "plataforma.isolation.grace=PT0.6S"
    })
class IsolationIT {

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
  @Autowired MongoClient client;
  @Autowired MongoDatabaseFactory factory;
  @Autowired TenantPlacements placements;
  @Autowired io.micrometer.core.instrument.MeterRegistry metricas;
  @Autowired Outbox outbox;
  @Autowired PlatformTransactionManager txManager;

  private TenantAlterado alterado(String tenant, NivelIsolamento nivel, long versao) {
    return TenantAlterado.newBuilder()
        .setEventId(UUID.randomUUID())
        .setTenantId(tenant)
        .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
        .setNome(tenant)
        .setPlano(Plano.PROFISSIONAL)
        .setNivelIsolamento(nivel)
        .setAtivo(true)
        .setVersao(versao)
        .build();
  }

  private long contar(String database, String tenant) {
    return client
        .getDatabase(database)
        .getCollection("notas")
        .countDocuments(Filters.eq("tenantId", tenant));
  }

  private void gravarNota(TenantId tenant, String id) {
    TenantContext.runAs(tenant, () -> mongo.insert(new Nota(id, null, "texto")));
  }

  @Test
  void tenantPoolFicaNaDatabasePadrao() {
    TenantId pool = new TenantId("pool-um");
    gravarNota(pool, "p1");
    assertThat(contar("plataforma", "pool-um")).isEqualTo(1);
    assertThat(placements.of(pool).level()).isEqualTo(IsolationLevel.POOL);
    assertThat(placements.databaseFor(pool)).isEqualTo("plataforma");
  }

  @Test
  void promocaoPorEventoMigraOsDadosERoteiaParaADatabaseDedicada() {
    mongo
        .indexOps(Nota.class)
        .createIndex(
            new Index()
                .on("tenantId", org.springframework.data.domain.Sort.Direction.ASC)
                .on("texto", org.springframework.data.domain.Sort.Direction.ASC)
                .named("ix_texto"));
    TenantId acme = new TenantId("acme");
    TenantId vizinho = new TenantId("vizinho");
    for (int i = 0; i < 3; i++) {
      gravarNota(acme, "a" + i);
    }
    gravarNota(vizinho, "v1");

    // tenant.alterado com BRIDGE, publicado pelo outbox e consumido pelo EventSubscriber.
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> outbox.append(alterado("acme", NivelIsolamento.BRIDGE, 1), "acme"));

    await()
        .atMost(Duration.ofSeconds(30))
        .until(() -> placements.of(acme).database().equals("plataforma_t_acme"));
    await()
        .atMost(Duration.ofSeconds(30))
        .until(() -> placements.of(acme).status() == TenantPlacement.Status.READY);

    assertThat(contar("plataforma_t_acme", "acme")).isEqualTo(3);
    assertThat(contar("plataforma", "acme")).isZero();
    assertThat(contar("plataforma", "vizinho")).isEqualTo(1);
    List<String> indices = new ArrayList<>();
    client
        .getDatabase("plataforma_t_acme")
        .getCollection("notas")
        .listIndexes()
        .forEach(d -> indices.add(d.getString("name")));
    assertThat(indices).contains("ix_texto");
    assertThat(placements.of(acme).migratedAt()).isNotNull();

    // Nova gravação do tenant numa transação: a nota vai para a dedicada e o outbox fica na padrão.
    long outboxAntes = mongo.count(new Query(), OutboxMessage.class);
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s ->
                TenantContext.runAs(
                    acme,
                    () -> {
                      mongo.insert(new Nota("a-nova", null, "depois"));
                      outbox.append(alterado("acme", NivelIsolamento.BRIDGE, 2), "acme");
                    }));
    assertThat(contar("plataforma_t_acme", "acme")).isEqualTo(4);
    assertThat(mongo.count(new Query(), OutboxMessage.class)).isEqualTo(outboxAntes + 1);
    assertThat(TenantContext.callAsUnchecked(acme, () -> mongo.findById("a1", Nota.class)))
        .isNotNull();
    assertThat(TenantContext.callAsUnchecked(acme, () -> factory.getMongoDatabase().getName()))
        .isEqualTo("plataforma_t_acme");
    assertThat(factory.getMongoDatabase().getName()).isEqualTo("plataforma");
  }

  @Test
  void duranteAMigracaoAsOperacoesDoTenantRecusamEVersaoAntigaEIgnorada() {
    TenantId lento = new TenantId("lento");
    assertThat(placements.observe(lento, IsolationLevel.SILO, 5)).isPresent();
    assertThatThrownBy(() -> TenantContext.runAs(lento, () -> mongo.findById("x", Nota.class)))
        .isInstanceOf(TenantMigratingException.class)
        .hasMessageContaining("lento");
    // Versão menor ou igual: ignorada.
    assertThat(placements.observe(lento, IsolationLevel.POOL, 5)).isEmpty();
    assertThat(placements.of(lento).level()).isEqualTo(IsolationLevel.SILO);
    // Quem está no meio da migração e recebe outra mudança continua migrando.
    assertThat(placements.observe(lento, IsolationLevel.SILO, 6)).isEmpty();
    assertThat(placements.of(lento).migrating()).isTrue();
    assertThat(metricas.get("plataforma.isolamento.migrando").gauge().value())
        .isGreaterThanOrEqualTo(1);
    assertThat(metricas.get("plataforma.isolamento.tentativas").gauge().value()).isZero();
    assertThat(metricas.get("plataforma.isolamento.falhas").functionCounter().count()).isZero();

    // Ninguém migra esse tenant nesta réplica: depois do lease, outra réplica assume (uma só).
    TenantPlacement parado = placements.of(lento);
    var leaseLongo =
        new TenantPlacements(
            client.getDatabase("plataforma"),
            java.time.Clock.systemUTC(),
            Duration.ofMinutes(1),
            Duration.ofHours(1));
    var leaseVencido =
        new TenantPlacements(
            client.getDatabase("plataforma"),
            java.time.Clock.systemUTC(),
            Duration.ofMinutes(1),
            Duration.ZERO);
    assertThat(leaseLongo.claimStale(parado)).isFalse();
    assertThat(leaseVencido.claimStale(parado)).isTrue();
    assertThat(leaseVencido.claimStale(parado)).isFalse();
    // A dona agora é a outra réplica: só ela marca como pronto.
    assertThat(placements.markReady(lento)).isFalse();
    assertThat(leaseVencido.markReady(lento)).isTrue();
    placements.refresh();
    assertThat(placements.awaitReady(lento, Duration.ofSeconds(1))).isTrue();
    assertThat(placements.databaseFor(lento)).isEqualTo("plataforma_t_lento");

    // SILO depois de BRIDGE não muda de database.
    assertThat(placements.observe(lento, IsolationLevel.BRIDGE, 7)).isEmpty();
    assertThat(placements.databaseFor(lento)).isEqualTo("plataforma_t_lento");
    // Rebaixar não move os dados (o tenant-service nem permite).
    assertThat(placements.observe(lento, IsolationLevel.POOL, 8)).isEmpty();
    assertThat(placements.databaseFor(lento)).isEqualTo("plataforma_t_lento");

    Document salvo =
        client
            .getDatabase("plataforma")
            .getCollection(TenantPlacements.COLLECTION)
            .find(Filters.eq("_id", "lento"))
            .first();
    assertThat(salvo).isNotNull();
    assertThat(salvo.getString("status")).isEqualTo("READY");
  }

  @Test
  void esperaPelaMigracaoDesisteNoPrazo() {
    TenantId preso = new TenantId("preso");
    placements.observe(preso, IsolationLevel.BRIDGE, 1);
    assertThat(placements.awaitReady(preso, Duration.ofMillis(300))).isFalse();
    placements.markReady(preso);
  }

  @Test
  void tenantCriadoJaEmBridgeNasceNaDatabaseDedicada() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s ->
                outbox.append(
                    br.dev.plataforma.contracts.tenants.TenantCriado.newBuilder()
                        .setEventId(UUID.randomUUID())
                        .setTenantId("nasce-bridge")
                        .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
                        .setNome("Nasce Bridge")
                        .setPlano(Plano.EMPRESARIAL)
                        .setNivelIsolamento(NivelIsolamento.BRIDGE)
                        .build(),
                    "nasce-bridge"));
    TenantId novo = new TenantId("nasce-bridge");
    await()
        .atMost(Duration.ofSeconds(30))
        .until(
            () ->
                placements.of(novo).database().equals("plataforma_t_nasce-bridge")
                    && !placements.of(novo).migrating());
    // A coleção de negócio já existe na database nova (nunca nasce dentro de uma transação).
    List<String> colecoes = new ArrayList<>();
    client.getDatabase("plataforma_t_nasce-bridge").listCollectionNames().into(colecoes);
    assertThat(colecoes).contains("notas");
    gravarNota(novo, "nb1");
    assertThat(contar("plataforma_t_nasce-bridge", "nasce-bridge")).isEqualTo(1);
  }

  @Test
  void quemPerdeOLeaseNaoMarcaNemRenova() {
    TenantId disputado = new TenantId("disputado");
    assertThat(placements.observe(disputado, IsolationLevel.BRIDGE, 1)).isPresent();
    assertThat(placements.heartbeat(disputado)).isTrue();
    // Outra réplica assumiu (lease vencido): o dono muda no banco.
    client
        .getDatabase("plataforma")
        .getCollection(TenantPlacements.COLLECTION)
        .updateOne(
            Filters.eq("_id", "disputado"),
            com.mongodb.client.model.Updates.set("owner", "outra-replica"));
    assertThat(placements.heartbeat(disputado)).isFalse();
    assertThat(placements.markReady(disputado)).isFalse();
    assertThat(placements.of(disputado).migrating()).isTrue();
    // Uma versão nova (mudança de plano) não apaga a migração em andamento.
    assertThat(placements.observe(disputado, IsolationLevel.SILO, 2)).isEmpty();
    assertThat(placements.of(disputado).migrating()).isTrue();
    assertThat(placements.of(disputado).owner()).isEqualTo("outra-replica");
  }
}
