package br.dev.plataforma.pedidos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.contracts.catalogo.PrecoAlterado;
import br.dev.plataforma.contracts.catalogo.ProdutoAlterado;
import br.dev.plataforma.contracts.pagamentos.PagamentoAprovado;
import br.dev.plataforma.contracts.pagamentos.PagamentoRecusado;
import br.dev.plataforma.contracts.pedidos.PedidoCancelado;
import br.dev.plataforma.contracts.pedidos.PedidoConfirmado;
import br.dev.plataforma.contracts.pedidos.PedidoCriado;
import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import br.dev.plataforma.contracts.tenants.TenantAlterado;
import br.dev.plataforma.spring.outbox.AvroCodec;
import br.dev.plataforma.spring.outbox.OutboxMessage;
import br.dev.plataforma.spring.outbox.PulsarEventPublisher;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.apache.avro.specific.SpecificRecord;
import org.apache.pulsar.client.admin.PulsarAdmin;
import org.apache.pulsar.client.api.Consumer;
import org.apache.pulsar.client.api.Message;
import org.apache.pulsar.client.api.PulsarClient;
import org.apache.pulsar.client.api.Schema;
import org.apache.pulsar.client.api.SubscriptionInitialPosition;
import org.apache.pulsar.common.policies.data.TenantInfo;
import org.bson.types.ObjectId;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MongoDBContainer;
import org.testcontainers.containers.PulsarContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * O serviço inteiro pela API HTTP, com MongoDB e Pulsar reais. O catálogo é simulado publicando
 * produto.alterado e preco.alterado como o catalogo-service publicaria. Cada teste usa tenants
 * próprios, então a ordem dos testes não importa.
 */
@Testcontainers
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "server.shutdown=immediate",
      "plataforma.pedidos.expiracao=PT2S",
      "plataforma.pedidos.expiracao-intervalo=PT1H"
    })
class PedidosServiceIT {

  @Container static final MongoDBContainer MONGO = new MongoDBContainer("mongo:8.0");

  @Container
  static final PulsarContainer PULSAR =
      new PulsarContainer(DockerImageName.parse("apachepulsar/pulsar:4.0.7"));

  @DynamicPropertySource
  static void propriedades(DynamicPropertyRegistry registry) {
    registry.add("spring.data.mongodb.uri", () -> MONGO.getReplicaSetUrl("pedidos"));
    registry.add("spring.pulsar.client.service-url", PULSAR::getPulsarBrokerUrl);
    registry.add("spring.pulsar.admin.service-url", PULSAR::getHttpServiceUrl);
  }

  @BeforeAll
  static void criarNamespaces() throws Exception {
    try (PulsarAdmin admin =
        PulsarAdmin.builder().serviceHttpUrl(PULSAR.getHttpServiceUrl()).build()) {
      admin
          .tenants()
          .createTenant(
              "plataforma", TenantInfo.builder().allowedClusters(Set.of("standalone")).build());
      admin.namespaces().createNamespace("plataforma/tenants");
      admin.namespaces().createNamespace("plataforma/catalogo");
      admin.namespaces().createNamespace("plataforma/pedidos");
      admin.namespaces().createNamespace("plataforma/pagamentos");
    }
  }

  @LocalServerPort int port;
  @Autowired MongoTemplate mongo;
  @Autowired PulsarClient pulsar;
  @Autowired ExpiracaoPedidos expiracao;

  final HttpClient http = HttpClient.newHttpClient();
  final ObjectMapper json = new ObjectMapper();

  record Resposta(int status, JsonNode corpo, HttpResponse<String> http) {}

  /**
   * @param papel valor do X-Papeis; null não manda o cabeçalho
   * @param cliente valor do X-Cliente-Id; null não manda o cabeçalho
   * @param chave valor do Idempotency-Key; null não manda o cabeçalho
   */
  Resposta chamar(
      String metodo,
      String caminho,
      String tenant,
      String papel,
      String cliente,
      String chave,
      String corpo)
      throws Exception {
    HttpRequest.Builder req =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + caminho))
            .header("Content-Type", "application/json")
            .header("X-Tenant-Id", tenant)
            .header("X-Usuario", "teste")
            .method(
                metodo,
                corpo == null
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(corpo));
    if (papel != null) {
      req.header("X-Papeis", papel);
    }
    if (cliente != null) {
      req.header("X-Cliente-Id", cliente);
    }
    if (chave != null) {
      req.header("Idempotency-Key", chave);
    }
    HttpResponse<String> resp = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
    return new Resposta(
        resp.statusCode(), resp.body().isBlank() ? null : json.readTree(resp.body()), resp);
  }

  Resposta comprar(String tenant, String cliente, String chave, String itens) throws Exception {
    return chamar(
        "POST",
        "/api/v1/pedidos",
        tenant,
        "comprador",
        cliente,
        chave,
        "{\"itens\":" + itens + "}");
  }

  Resposta comoComprador(String metodo, String caminho, String tenant, String cliente)
      throws Exception {
    return chamar(metodo, caminho, tenant, "comprador", cliente, null, null);
  }

  Resposta comoGestor(String metodo, String caminho, String tenant) throws Exception {
    return chamar(metodo, caminho, tenant, "gestor-tenant", null, null, null);
  }

  static String item(String produtoId, int quantidade) {
    return "{\"produtoId\":\"" + produtoId + "\",\"quantidade\":" + quantidade + "}";
  }

  static String chave() {
    return UUID.randomUUID().toString();
  }

  /** Publica como o catalogo-service: bytes Avro com o schema do escritor no tópico do contrato. */
  void publicar(SpecificRecord evento, String tenant, String produtoId) throws Exception {
    var contrato = EventCatalog.defaultCatalog().of(evento.getClass());
    try (var publisher =
        new PulsarEventPublisher(pulsar, EventCatalog.defaultCatalog(), Duration.ofSeconds(10))) {
      publisher.publish(
          new OutboxMessage(
              UUID.randomUUID().toString(),
              tenant,
              contrato.event(),
              contrato.topic(),
              tenant + ":" + produtoId,
              AvroCodec.encode(evento),
              evento.getSchema().toString(),
              null,
              Instant.now(),
              new ObjectId().toHexString(),
              null,
              0,
              null));
    }
  }

  void produto(String tenant, String id, String nome, boolean ativo, long versao) throws Exception {
    publicar(
        ProdutoAlterado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId(tenant)
            .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
            .setProdutoId(id)
            .setSku("SKU-" + id.toUpperCase())
            .setNome(nome)
            .setAtivo(ativo)
            .setVersao(versao)
            .build(),
        tenant,
        id);
  }

  void preco(String tenant, String id, long centavos, String moeda, long versao) throws Exception {
    publicar(
        PrecoAlterado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId(tenant)
            .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
            .setProdutoId(id)
            .setSku("SKU-" + id.toUpperCase())
            .setPrecoCentavos(centavos)
            .setMoeda(moeda)
            .setVersao(versao)
            .build(),
        tenant,
        id);
  }

  /** Produto ativo com preço, e espera a cópia local ficar disponível. */
  void catalogo(String tenant, String id, long centavos) throws Exception {
    produto(tenant, id, "Produto " + id, true, 0);
    preco(tenant, id, centavos, "BRL", 0);
    esperar(tenant, id, p -> p.disponivel() && p.getPrecoCentavos() == centavos);
  }

  void esperar(String tenant, String id, java.util.function.Predicate<ProdutoLocal> condicao) {
    await()
        .atMost(30, TimeUnit.SECONDS)
        .untilAsserted(
            () -> {
              ProdutoLocal p = mongo.findById(ProdutoLocal.chave(tenant, id), ProdutoLocal.class);
              assertThat(p).isNotNull();
              assertThat(condicao).accepts(p);
            });
  }

  Consumer<byte[]> ouvir(String topico) throws Exception {
    return pulsar
        .newConsumer(Schema.BYTES)
        .topic(topico)
        .subscriptionName("teste-" + UUID.randomUUID())
        .subscriptionInitialPosition(SubscriptionInitialPosition.Latest)
        .subscribe();
  }

  @Test
  void criaComPrecoDoCatalogoPublicaPedidoCriadoERepeteSemDuplicar() throws Exception {
    catalogo("loja-a", "p1", 1290);
    catalogo("loja-a", "p2", 500);
    try (Consumer<byte[]> consumer = ouvir("persistent://plataforma/pedidos/pedido.criado.v1")) {
      String chave = chave();
      String itens = "[" + item("p1", 2) + "," + item("p2", 3) + "]";
      Resposta criado = comprar("loja-a", "cli-1", chave, itens);
      assertThat(criado.status()).isEqualTo(201);
      JsonNode pedido = criado.corpo();
      String id = pedido.get("id").asText();
      assertThat(criado.http().headers().firstValue("Location")).hasValue("/api/v1/pedidos/" + id);
      assertThat(pedido.get("status").asText()).isEqualTo("PENDENTE");
      assertThat(pedido.get("clienteId").asText()).isEqualTo("cli-1");
      assertThat(pedido.get("total").get("centavos").asLong()).isEqualTo(2 * 1290 + 3 * 500);
      assertThat(pedido.get("total").get("moeda").asText()).isEqualTo("BRL");
      assertThat(pedido.get("itens").get(0).get("nome").asText()).isEqualTo("Produto p1");
      assertThat(pedido.get("itens").get(0).get("sku").asText()).isEqualTo("SKU-P1");
      assertThat(pedido.get("itens").get(0).get("precoUnitario").get("centavos").asLong())
          .isEqualTo(1290);
      assertThat(pedido.get("motivoCancelamento").isNull()).isTrue();

      Message<byte[]> msg = consumer.receive(30, TimeUnit.SECONDS);
      assertThat(msg).isNotNull();
      assertThat(msg.getKey()).isEqualTo("loja-a:" + id);
      PedidoCriado evento = AvroCodec.decode(msg.getValue(), PedidoCriado.class);
      assertThat(evento.getPedidoId()).isEqualTo(id);
      assertThat(evento.getClienteId()).isEqualTo("cli-1");
      assertThat(evento.getTotalCentavos()).isEqualTo(4080);
      assertThat(evento.getItens()).hasSize(2);
      assertThat(evento.getVersao()).isZero();

      // Mesma chave e mesmo corpo: o mesmo pedido, sem outro evento.
      Resposta repetido = comprar("loja-a", "cli-1", chave, itens);
      assertThat(repetido.status()).isEqualTo(200);
      assertThat(repetido.http().headers().firstValue("Idempotent-Replayed")).hasValue("true");
      assertThat(repetido.corpo().get("id").asText()).isEqualTo(id);
      assertThat(consumer.receive(2, TimeUnit.SECONDS)).isNull();

      // Mesma chave com outro corpo: 409.
      Resposta outro = comprar("loja-a", "cli-1", chave, "[" + item("p1", 1) + "]");
      assertThat(outro.status()).isEqualTo(409);
      assertThat(outro.corpo().get("type").asText()).endsWith("/chave-reutilizada");

      // A chave é por cliente: outro cliente pode usar a mesma.
      assertThat(comprar("loja-a", "cli-2", chave, itens).status()).isEqualTo(201);

      // Preço novo no catálogo vale para pedidos novos; o antigo guarda o preço da época.
      preco("loja-a", "p1", 1500, "BRL", 1);
      esperar("loja-a", "p1", p -> p.getPrecoCentavos() == 1500);
      Resposta novo = comprar("loja-a", "cli-1", chave(), "[" + item("p1", 1) + "]");
      assertThat(novo.corpo().get("total").get("centavos").asLong()).isEqualTo(1500);
      assertThat(
              comoComprador("GET", "/api/v1/pedidos/" + id, "loja-a", "cli-1")
                  .corpo()
                  .get("total")
                  .get("centavos")
                  .asLong())
          .isEqualTo(4080);
    }
  }

  @Test
  void produtoInexistenteInativoOuSemPrecoFicaIndisponivel() throws Exception {
    catalogo("loja-b", "ok", 100);
    Resposta inexistente =
        comprar("loja-b", "cli-1", chave(), "[" + item("ok", 1) + "," + item("fantasma", 1) + "]");
    assertThat(inexistente.status()).isEqualTo(409);
    assertThat(inexistente.corpo().get("type").asText()).endsWith("/produto-indisponivel");
    assertThat(inexistente.corpo().get("produtos").get(0).asText()).isEqualTo("fantasma");

    // Só o preço chegou: ainda sem nome e situação, indisponível.
    preco("loja-b", "so-preco", 100, "BRL", 0);
    esperar("loja-b", "so-preco", p -> p.getPrecoCentavos() != null);
    assertThat(comprar("loja-b", "cli-1", chave(), "[" + item("so-preco", 1) + "]").status())
        .isEqualTo(409);

    // Desativado na versão 2; a versão 1 que chega atrasada não reativa.
    catalogo("loja-b", "sai", 100);
    produto("loja-b", "sai", "Sai", false, 2);
    esperar("loja-b", "sai", p -> !p.isAtivo());
    produto("loja-b", "sai", "Sai", true, 1);
    await()
        .during(Duration.ofSeconds(2))
        .atMost(10, TimeUnit.SECONDS)
        .untilAsserted(
            () ->
                assertThat(
                        mongo
                            .findById(ProdutoLocal.chave("loja-b", "sai"), ProdutoLocal.class)
                            .isAtivo())
                    .isFalse());
    assertThat(comprar("loja-b", "cli-1", chave(), "[" + item("sai", 1) + "]").status())
        .isEqualTo(409);

    // Produto de outro tenant não existe aqui.
    catalogo("loja-c", "alheio", 100);
    assertThat(comprar("loja-b", "cli-1", chave(), "[" + item("alheio", 1) + "]").status())
        .isEqualTo(409);

    // Moedas diferentes no mesmo pedido: 400.
    produto("loja-b", "usd", "Importado", true, 0);
    preco("loja-b", "usd", 100, "USD", 0);
    esperar("loja-b", "usd", ProdutoLocal::disponivel);
    assertThat(
            comprar("loja-b", "cli-1", chave(), "[" + item("ok", 1) + "," + item("usd", 1) + "]")
                .status())
        .isEqualTo(400);
  }

  @Test
  void papeisClienteEIsolamento() throws Exception {
    catalogo("loja-d", "p", 100);
    String itens = "[" + item("p", 1) + "]";
    String corpo = "{\"itens\":" + itens + "}";
    // Gestor não compra; comprador sem cliente também não.
    Resposta gestor =
        chamar("POST", "/api/v1/pedidos", "loja-d", "gestor-tenant", null, chave(), corpo);
    assertThat(gestor.status()).isEqualTo(403);
    assertThat(gestor.corpo().get("type").asText()).endsWith("/acesso-negado");
    assertThat(
            chamar("POST", "/api/v1/pedidos", "loja-d", "comprador", null, chave(), corpo).status())
        .isEqualTo(403);
    assertThat(chamar("GET", "/api/v1/pedidos", "loja-d", null, "cli-1", null, null).status())
        .isEqualTo(403);
    assertThat(comoComprador("GET", "/api/v1/pedidos", "loja-d", null).status()).isEqualTo(403);

    String meu = comprar("loja-d", "cli-1", chave(), itens).corpo().get("id").asText();
    String dele = comprar("loja-d", "cli-2", chave(), itens).corpo().get("id").asText();

    assertThat(comoComprador("GET", "/api/v1/pedidos/" + dele, "loja-d", "cli-1").status())
        .isEqualTo(404);
    assertThat(
            comoComprador("GET", "/api/v1/pedidos", "loja-d", "cli-1")
                .corpo()
                .get("itens")
                .findValuesAsText("id"))
        .containsExactly(meu);
    assertThat(
            comoGestor("GET", "/api/v1/pedidos", "loja-d")
                .corpo()
                .get("itens")
                .findValuesAsText("id"))
        .containsExactly(dele, meu);
    assertThat(comoGestor("GET", "/api/v1/pedidos/" + dele, "loja-d").status()).isEqualTo(200);
    // Outro tenant não enxerga.
    assertThat(comoGestor("GET", "/api/v1/pedidos/" + meu, "loja-e").status()).isEqualTo(404);
    assertThat(comoGestor("GET", "/api/v1/pedidos", "loja-e").corpo().get("itens")).isEmpty();
  }

  @Test
  void cancelaUmaVezEPublicaPedidoCancelado() throws Exception {
    catalogo("loja-f", "p", 100);
    String itens = "[" + item("p", 1) + "]";
    String meu = comprar("loja-f", "cli-1", chave(), itens).corpo().get("id").asText();
    String dele = comprar("loja-f", "cli-2", chave(), itens).corpo().get("id").asText();
    try (Consumer<byte[]> consumer = ouvir("persistent://plataforma/pedidos/pedido.cancelado.v1")) {
      assertThat(
              comoComprador("POST", "/api/v1/pedidos/" + dele + "/cancelamento", "loja-f", "cli-1")
                  .status())
          .isEqualTo(404);

      Resposta cancelado =
          comoComprador("POST", "/api/v1/pedidos/" + meu + "/cancelamento", "loja-f", "cli-1");
      assertThat(cancelado.status()).isEqualTo(200);
      assertThat(cancelado.corpo().get("status").asText()).isEqualTo("CANCELADO");
      assertThat(cancelado.corpo().get("motivoCancelamento").asText())
          .isEqualTo("SOLICITADO_PELO_CLIENTE");

      Message<byte[]> msg = consumer.receive(30, TimeUnit.SECONDS);
      assertThat(msg).isNotNull();
      PedidoCancelado evento = AvroCodec.decode(msg.getValue(), PedidoCancelado.class);
      assertThat(evento.getPedidoId()).isEqualTo(meu);
      assertThat(evento.getVersao()).isEqualTo(1);
      assertThat(evento.getMotivo().name()).isEqualTo("SOLICITADO_PELO_CLIENTE");

      Resposta deNovo =
          comoComprador("POST", "/api/v1/pedidos/" + meu + "/cancelamento", "loja-f", "cli-1");
      assertThat(deNovo.status()).isEqualTo(409);
      assertThat(deNovo.corpo().get("type").asText()).endsWith("/pedido-ja-cancelado");
      assertThat(consumer.receive(2, TimeUnit.SECONDS)).isNull();

      // O gestor cancela pedido de qualquer cliente; o motivo diz quem cancelou.
      Resposta peloGestor =
          comoGestor("POST", "/api/v1/pedidos/" + dele + "/cancelamento", "loja-f");
      assertThat(peloGestor.status()).isEqualTo(200);
      assertThat(peloGestor.corpo().get("motivoCancelamento").asText())
          .isEqualTo("CANCELADO_PELO_TENANT");
    }
    Resposta cancelados = comoGestor("GET", "/api/v1/pedidos?status=CANCELADO", "loja-f");
    assertThat(cancelados.corpo().get("itens").findValuesAsText("id"))
        .containsExactlyInAnyOrder(meu, dele);
    assertThat(comoGestor("GET", "/api/v1/pedidos?status=PENDENTE", "loja-f").corpo().get("itens"))
        .isEmpty();
  }

  @Test
  void paginacaoEValidacao() throws Exception {
    catalogo("loja-g", "p", 100);
    String itens = "[" + item("p", 1) + "]";
    String a = comprar("loja-g", "cli-1", chave(), itens).corpo().get("id").asText();
    String b = comprar("loja-g", "cli-1", chave(), itens).corpo().get("id").asText();
    String c = comprar("loja-g", "cli-1", chave(), itens).corpo().get("id").asText();

    Resposta p1 = comoComprador("GET", "/api/v1/pedidos?limite=2", "loja-g", "cli-1");
    assertThat(p1.corpo().get("itens").findValuesAsText("id")).containsExactly(c, b);
    String cursor = p1.corpo().get("proximoCursor").asText();
    Resposta p2 =
        comoComprador("GET", "/api/v1/pedidos?limite=2&cursor=" + cursor, "loja-g", "cli-1");
    assertThat(p2.corpo().get("itens").findValuesAsText("id")).containsExactly(a);
    assertThat(p2.corpo().get("proximoCursor").isNull()).isTrue();

    assertThat(comoComprador("GET", "/api/v1/pedidos?limite=0", "loja-g", "cli-1").status())
        .isEqualTo(400);
    assertThat(comoComprador("GET", "/api/v1/pedidos?cursor=@@@", "loja-g", "cli-1").status())
        .isEqualTo(400);
    assertThat(comoComprador("GET", "/api/v1/pedidos?status=PAGO", "loja-g", "cli-1").status())
        .isEqualTo(400);

    // Sem chave, chave curta, sem itens, quantidade fora da faixa, produto repetido, JSON ruim.
    assertThat(comprar("loja-g", "cli-1", null, itens).status()).isEqualTo(400);
    Resposta curta = comprar("loja-g", "cli-1", "curta", itens);
    assertThat(curta.status()).isEqualTo(400);
    assertThat(curta.corpo().get("detail").asText()).contains("Idempotency-Key");
    assertThat(comprar("loja-g", "cli-1", chave(), "[]").status()).isEqualTo(400);
    assertThat(comprar("loja-g", "cli-1", chave(), "[" + item("p", 0) + "]").status())
        .isEqualTo(400);
    assertThat(comprar("loja-g", "cli-1", chave(), "[" + item("p", 10001) + "]").status())
        .isEqualTo(400);
    assertThat(
            comprar("loja-g", "cli-1", chave(), "[" + item("p", 1) + "," + item("p", 2) + "]")
                .status())
        .isEqualTo(400);
    assertThat(
            comprar("loja-g", "cli-1", chave(), "[{\"produtoId\":\"p\",\"quantidade\":\"x\"}]")
                .status())
        .isEqualTo(400);
    assertThat(comoComprador("GET", "/api/v1/pedidos/nao-existe", "loja-g", "cli-1").status())
        .isEqualTo(404);
  }

  @Test
  void doisPostsSimultaneosComAMesmaChaveCriamUmPedidoSo() throws Exception {
    catalogo("loja-h", "p", 100);
    String chave = chave();
    String itens = "[" + item("p", 1) + "]";
    ExecutorService pool = Executors.newFixedThreadPool(4);
    try {
      List<Future<Resposta>> tarefas = new ArrayList<>();
      for (int i = 0; i < 4; i++) {
        tarefas.add(pool.submit(() -> comprar("loja-h", "cli-1", chave, itens)));
      }
      List<Integer> status = new ArrayList<>();
      for (Future<Resposta> t : tarefas) {
        status.add(t.get(30, TimeUnit.SECONDS).status());
      }
      // Uma cria; as outras repetem (200) ou batem na criação em andamento (409 conflito).
      assertThat(status).allMatch(s -> s == 201 || s == 200 || s == 409);
      assertThat(status.stream().filter(s -> s == 201)).hasSize(1);
    } finally {
      pool.shutdownNow();
    }
    Resposta repetido = comprar("loja-h", "cli-1", chave, itens);
    assertThat(repetido.status()).isEqualTo(200);
    assertThat(comoComprador("GET", "/api/v1/pedidos", "loja-h", "cli-1").corpo().get("itens"))
        .hasSize(1);
  }

  @Test
  void tenantSuspensoNaoCriaPedidoMasCancela() throws Exception {
    catalogo("loja-i", "p", 100);
    String itens = "[" + item("p", 1) + "]";
    String antes = comprar("loja-i", "cli-1", chave(), itens).corpo().get("id").asText();
    publicar(
        TenantAlterado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId("loja-i")
            .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
            .setNome("Loja I")
            .setPlano(Plano.GRATUITO)
            .setNivelIsolamento(NivelIsolamento.POOL)
            .setAtivo(false)
            .setVersao(1)
            .build(),
        "loja-i",
        "loja-i");
    await()
        .atMost(30, TimeUnit.SECONDS)
        .untilAsserted(
            () -> {
              TenantSituacao t = mongo.findById("loja-i", TenantSituacao.class);
              assertThat(t).isNotNull();
              assertThat(t.isAtivo()).isFalse();
            });
    Resposta suspenso = comprar("loja-i", "cli-1", chave(), itens);
    assertThat(suspenso.status()).isEqualTo(403);
    assertThat(suspenso.corpo().get("type").asText()).endsWith("/tenant-suspenso");
    assertThat(
            comoComprador("POST", "/api/v1/pedidos/" + antes + "/cancelamento", "loja-i", "cli-1")
                .status())
        .isEqualTo(200);
  }

  void aprovado(String tenant, String pedidoId, String pagamentoId) throws Exception {
    publicar(
        PagamentoAprovado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId(tenant)
            .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
            .setPagamentoId(pagamentoId)
            .setPedidoId(pedidoId)
            .setValorCentavos(100)
            .setMoeda("BRL")
            .setChaveIdempotencia(tenant + ":" + pedidoId)
            .build(),
        tenant,
        pedidoId);
  }

  String status(String tenant, String pedidoId) throws Exception {
    return comoGestor("GET", "/api/v1/pedidos/" + pedidoId, tenant).corpo().get("status").asText();
  }

  @Test
  void pagamentoAprovadoConfirmaERecusadoCancela() throws Exception {
    catalogo("loja-j", "p", 100);
    String itens = "[" + item("p", 1) + "]";
    String pago = comprar("loja-j", "cli-1", chave(), itens).corpo().get("id").asText();
    String recusado = comprar("loja-j", "cli-1", chave(), itens).corpo().get("id").asText();
    String jaCancelado = comprar("loja-j", "cli-1", chave(), itens).corpo().get("id").asText();
    comoComprador("POST", "/api/v1/pedidos/" + jaCancelado + "/cancelamento", "loja-j", "cli-1");
    try (Consumer<byte[]> consumer =
        ouvir("persistent://plataforma/pedidos/pedido.confirmado.v1")) {
      aprovado("loja-j", pago, "pag-1");
      Message<byte[]> msg = consumer.receive(30, TimeUnit.SECONDS);
      assertThat(msg).isNotNull();
      PedidoConfirmado evento = AvroCodec.decode(msg.getValue(), PedidoConfirmado.class);
      assertThat(evento.getPedidoId()).isEqualTo(pago);
      assertThat(evento.getPagamentoId()).isEqualTo("pag-1");
      assertThat(evento.getVersao()).isEqualTo(1);
      JsonNode confirmado =
          comoComprador("GET", "/api/v1/pedidos/" + pago, "loja-j", "cli-1").corpo();
      assertThat(confirmado.get("status").asText()).isEqualTo("CONFIRMADO");
      assertThat(confirmado.get("pagamentoId").asText()).isEqualTo("pag-1");

      // Aprovado de um pedido já cancelado não o ressuscita (o estorno é com Pagamentos).
      aprovado("loja-j", jaCancelado, "pag-2");
      assertThat(consumer.receive(3, TimeUnit.SECONDS)).isNull();
      assertThat(status("loja-j", jaCancelado)).isEqualTo("CANCELADO");
    }
    publicar(
        PagamentoRecusado.newBuilder()
            .setEventId(UUID.randomUUID())
            .setTenantId("loja-j")
            .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
            .setPagamentoId("pag-3")
            .setPedidoId(recusado)
            .setMotivo("Valor acima do limite")
            .build(),
        "loja-j",
        recusado);
    await()
        .atMost(30, TimeUnit.SECONDS)
        .untilAsserted(() -> assertThat(status("loja-j", recusado)).isEqualTo("CANCELADO"));
    assertThat(
            comoGestor("GET", "/api/v1/pedidos/" + recusado, "loja-j")
                .corpo()
                .get("motivoCancelamento")
                .asText())
        .isEqualTo("PAGAMENTO_RECUSADO");
    // Cliente cancela um pedido já pago: vale (Pagamentos estorna ao receber o pedido.cancelado).
    assertThat(
            comoComprador("POST", "/api/v1/pedidos/" + pago + "/cancelamento", "loja-j", "cli-1")
                .status())
        .isEqualTo(200);
  }

  @Test
  void pendenteSemRespostaDoPagamentoExpira() throws Exception {
    catalogo("loja-k", "p", 100);
    String itens = "[" + item("p", 1) + "]";
    String velho = comprar("loja-k", "cli-1", chave(), itens).corpo().get("id").asText();
    Thread.sleep(2500);
    String novo = comprar("loja-k", "cli-1", chave(), itens).corpo().get("id").asText();
    try (Consumer<byte[]> consumer = ouvir("persistent://plataforma/pedidos/pedido.cancelado.v1")) {
      assertThat(expiracao.expirarVencidos()).isGreaterThanOrEqualTo(1);
      JsonNode expirado = comoGestor("GET", "/api/v1/pedidos/" + velho, "loja-k").corpo();
      assertThat(expirado.get("status").asText()).isEqualTo("CANCELADO");
      assertThat(expirado.get("motivoCancelamento").asText()).isEqualTo("EXPIRADO");
      assertThat(status("loja-k", novo)).isEqualTo("PENDENTE");
      boolean viu = false;
      for (Message<byte[]> m = consumer.receive(10, TimeUnit.SECONDS);
          m != null;
          m = consumer.receive(2, TimeUnit.SECONDS)) {
        PedidoCancelado e = AvroCodec.decode(m.getValue(), PedidoCancelado.class);
        viu |= e.getPedidoId().equals(velho) && e.getMotivo().name().equals("EXPIRADO");
      }
      assertThat(viu).isTrue();
    }
    // Rodar de novo não mexe no pedido já cancelado.
    JsonNode antes = comoGestor("GET", "/api/v1/pedidos/" + velho, "loja-k").corpo();
    expiracao.expirarVencidos();
    assertThat(comoGestor("GET", "/api/v1/pedidos/" + velho, "loja-k").corpo()).isEqualTo(antes);
  }
}
