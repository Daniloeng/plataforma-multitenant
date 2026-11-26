package br.dev.plataforma.pagamentos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.contracts.pagamentos.PagamentoAprovado;
import br.dev.plataforma.contracts.pagamentos.PagamentoEstornado;
import br.dev.plataforma.contracts.pagamentos.PagamentoRecusado;
import br.dev.plataforma.contracts.pedidos.ItemPedido;
import br.dev.plataforma.contracts.pedidos.MotivoCancelamento;
import br.dev.plataforma.contracts.pedidos.PedidoCancelado;
import br.dev.plataforma.contracts.pedidos.PedidoCriado;
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
import java.util.List;
import java.util.Set;
import java.util.UUID;
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
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MongoDBContainer;
import org.testcontainers.containers.PulsarContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * O serviço inteiro com MongoDB e Pulsar reais. Os eventos de pedido são publicados como o
 * pedidos-service publicaria; o limite do gateway simulado é R$ 100,00 neste teste.
 */
@Testcontainers
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "server.shutdown=immediate",
      "plataforma.pagamentos.limite-aprovacao-centavos=10000"
    })
class PagamentosServiceIT {

  @Container static final MongoDBContainer MONGO = new MongoDBContainer("mongo:8.0");

  @Container
  static final PulsarContainer PULSAR =
      new PulsarContainer(DockerImageName.parse("apachepulsar/pulsar:4.0.7"));

  @DynamicPropertySource
  static void propriedades(DynamicPropertyRegistry registry) {
    registry.add("spring.data.mongodb.uri", () -> MONGO.getReplicaSetUrl("pagamentos"));
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
      admin.namespaces().createNamespace("plataforma/pedidos");
      admin.namespaces().createNamespace("plataforma/pagamentos");
    }
  }

  @LocalServerPort int port;
  @Autowired MongoTemplate mongo;
  @Autowired PulsarClient pulsar;

  final HttpClient http = HttpClient.newHttpClient();
  final ObjectMapper json = new ObjectMapper();

  record Resposta(int status, JsonNode corpo) {}

  Resposta chamar(String caminho, String tenant, String papel) throws Exception {
    HttpRequest req =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + caminho))
            .header("X-Tenant-Id", tenant)
            .header("X-Usuario", "teste")
            .header("X-Papeis", papel)
            .GET()
            .build();
    HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
    return new Resposta(
        resp.statusCode(), resp.body().isBlank() ? null : json.readTree(resp.body()));
  }

  Resposta gestor(String caminho, String tenant) throws Exception {
    return chamar(caminho, tenant, "gestor-tenant");
  }

  void publicar(SpecificRecord evento, String tenant, String pedidoId) throws Exception {
    var contrato = EventCatalog.defaultCatalog().of(evento.getClass());
    try (var publisher =
        new PulsarEventPublisher(pulsar, EventCatalog.defaultCatalog(), Duration.ofSeconds(10))) {
      publisher.publish(
          new OutboxMessage(
              UUID.randomUUID().toString(),
              tenant,
              contrato.event(),
              contrato.topic(),
              tenant + ":" + pedidoId,
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

  PedidoCriado criado(String tenant, String pedidoId, long total, UUID eventId) {
    return PedidoCriado.newBuilder()
        .setEventId(eventId)
        .setTenantId(tenant)
        .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
        .setPedidoId(pedidoId)
        .setClienteId("cli-1")
        .setItens(
            List.of(
                ItemPedido.newBuilder()
                    .setProdutoId("p")
                    .setSku("P")
                    .setQuantidade(1)
                    .setPrecoUnitarioCentavos(total)
                    .build()))
        .setTotalCentavos(total)
        .setMoeda("BRL")
        .setVersao(0)
        .build();
  }

  PedidoCancelado cancelado(String tenant, String pedidoId) {
    return PedidoCancelado.newBuilder()
        .setEventId(UUID.randomUUID())
        .setTenantId(tenant)
        .setOccurredAt(Instant.now().truncatedTo(ChronoUnit.MILLIS))
        .setPedidoId(pedidoId)
        .setMotivo(MotivoCancelamento.SOLICITADO_PELO_CLIENTE)
        .setVersao(1)
        .build();
  }

  Consumer<byte[]> ouvir(String evento) throws Exception {
    return pulsar
        .newConsumer(Schema.BYTES)
        .topic("persistent://plataforma/pagamentos/" + evento + ".v1")
        .subscriptionName("teste-" + UUID.randomUUID())
        .subscriptionInitialPosition(SubscriptionInitialPosition.Latest)
        .subscribe();
  }

  PagamentoDocument pagamentoDo(String tenant, String pedidoId) {
    return mongo.findOne(
        Query.query(Criteria.where("tenantId").is(tenant).and("pedidoId").is(pedidoId)),
        PagamentoDocument.class);
  }

  @Test
  void aprovaUmaVezLancaPartidaDobradaEEstornaNoCancelamento() throws Exception {
    UUID eventId = UUID.randomUUID();
    try (Consumer<byte[]> aprovados = ouvir("pagamento.aprovado");
        Consumer<byte[]> estornados = ouvir("pagamento.estornado")) {
      publicar(criado("loja-a", "ped-1", 4990, eventId), "loja-a", "ped-1");
      Message<byte[]> msg = aprovados.receive(30, TimeUnit.SECONDS);
      assertThat(msg).isNotNull();
      assertThat(msg.getKey()).isEqualTo("loja-a:ped-1");
      PagamentoAprovado evento = AvroCodec.decode(msg.getValue(), PagamentoAprovado.class);
      assertThat(evento.getPedidoId()).isEqualTo("ped-1");
      assertThat(evento.getValorCentavos()).isEqualTo(4990);
      assertThat(evento.getChaveIdempotencia()).isEqualTo("loja-a:ped-1");

      // Reentrega do mesmo evento e outro evento do mesmo pedido: nenhuma cobrança nova.
      publicar(criado("loja-a", "ped-1", 4990, eventId), "loja-a", "ped-1");
      publicar(criado("loja-a", "ped-1", 4990, UUID.randomUUID()), "loja-a", "ped-1");
      assertThat(aprovados.receive(3, TimeUnit.SECONDS)).isNull();

      Resposta lista = gestor("/api/v1/pagamentos", "loja-a");
      assertThat(lista.status()).isEqualTo(200);
      assertThat(lista.corpo().get("itens")).hasSize(1);
      JsonNode pagamento = lista.corpo().get("itens").get(0);
      assertThat(pagamento.get("status").asText()).isEqualTo("APROVADO");
      assertThat(pagamento.get("valor").get("centavos").asLong()).isEqualTo(4990);
      assertThat(pagamento.get("clienteId").asText()).isEqualTo("cli-1");
      assertThat(pagamento.get("id").asText()).isEqualTo(evento.getPagamentoId());

      Resposta extrato = gestor("/api/v1/ledger/lancamentos", "loja-a");
      assertThat(extrato.corpo().get("itens")).hasSize(2);
      assertThat(extrato.corpo().get("itens").findValuesAsText("conta"))
          .containsExactlyInAnyOrder("CAIXA_GATEWAY", "RECEITA_TENANT");
      assertThat(extrato.corpo().get("saldo").get("centavos").asLong()).isEqualTo(4990);
      // Saldo por moeda: os reais não entram no saldo em dólares.
      JsonNode saldoUsd =
          gestor("/api/v1/ledger/lancamentos?moeda=USD", "loja-a").corpo().get("saldo");
      assertThat(saldoUsd.get("centavos").asLong()).isZero();
      assertThat(saldoUsd.get("moeda").asText()).isEqualTo("USD");

      publicar(cancelado("loja-a", "ped-1"), "loja-a", "ped-1");
      Message<byte[]> estorno = estornados.receive(30, TimeUnit.SECONDS);
      assertThat(estorno).isNotNull();
      assertThat(AvroCodec.decode(estorno.getValue(), PagamentoEstornado.class).getValorCentavos())
          .isEqualTo(4990);
      // Cancelamento repetido não estorna de novo.
      publicar(cancelado("loja-a", "ped-1"), "loja-a", "ped-1");
      assertThat(estornados.receive(3, TimeUnit.SECONDS)).isNull();
    }
    assertThat(gestor("/api/v1/pagamentos?status=ESTORNADO", "loja-a").corpo().get("itens"))
        .hasSize(1);
    Resposta extrato = gestor("/api/v1/ledger/lancamentos", "loja-a");
    assertThat(extrato.corpo().get("itens")).hasSize(4);
    assertThat(extrato.corpo().get("saldo").get("centavos").asLong()).isZero();
  }

  @Test
  void acimaDoLimiteRecusaSemLancamento() throws Exception {
    try (Consumer<byte[]> recusados = ouvir("pagamento.recusado")) {
      publicar(criado("loja-b", "ped-caro", 10001, UUID.randomUUID()), "loja-b", "ped-caro");
      Message<byte[]> msg = recusados.receive(30, TimeUnit.SECONDS);
      assertThat(msg).isNotNull();
      assertThat(AvroCodec.decode(msg.getValue(), PagamentoRecusado.class).getMotivo())
          .contains("R$ 100,00");
    }
    JsonNode pagamento = gestor("/api/v1/pagamentos?pedidoId=ped-caro", "loja-b").corpo();
    assertThat(pagamento.get("itens").get(0).get("status").asText()).isEqualTo("RECUSADO");
    assertThat(pagamento.get("itens").get(0).get("motivoRecusa").asText()).contains("limite");
    Resposta extrato = gestor("/api/v1/ledger/lancamentos", "loja-b");
    assertThat(extrato.corpo().get("itens")).isEmpty();
    assertThat(extrato.corpo().get("saldo").get("centavos").asLong()).isZero();
    assertThat(extrato.corpo().get("saldo").get("moeda").asText()).isEqualTo("BRL");
    // Cancelar o pedido recusado não estorna nada.
    publicar(cancelado("loja-b", "ped-caro"), "loja-b", "ped-caro");
    await()
        .atMost(30, TimeUnit.SECONDS)
        .until(() -> pagamentoDo("loja-b", "ped-caro").isPedidoCancelado());
    assertThat(pagamentoDo("loja-b", "ped-caro").getStatus()).isEqualTo(StatusPagamento.RECUSADO);
  }

  @Test
  void cancelamentoQueChegaAntesImpedeACobranca() throws Exception {
    publicar(cancelado("loja-c", "ped-x"), "loja-c", "ped-x");
    await()
        .atMost(30, TimeUnit.SECONDS)
        .untilAsserted(() -> assertThat(pagamentoDo("loja-c", "ped-x")).isNotNull());
    try (Consumer<byte[]> aprovados = ouvir("pagamento.aprovado")) {
      publicar(criado("loja-c", "ped-x", 100, UUID.randomUUID()), "loja-c", "ped-x");
      assertThat(aprovados.receive(5, TimeUnit.SECONDS)).isNull();
    }
    assertThat(pagamentoDo("loja-c", "ped-x").getStatus()).isNull();
    // A marca não aparece como pagamento.
    assertThat(gestor("/api/v1/pagamentos", "loja-c").corpo().get("itens")).isEmpty();
    String marca = pagamentoDo("loja-c", "ped-x").getId();
    assertThat(gestor("/api/v1/pagamentos/" + marca, "loja-c").status()).isEqualTo(404);
  }

  @Test
  void papeisIsolamentoEPaginacao() throws Exception {
    for (int i = 1; i <= 3; i++) {
      publicar(criado("loja-d", "ped-" + i, 100 * i, UUID.randomUUID()), "loja-d", "ped-" + i);
    }
    await()
        .atMost(30, TimeUnit.SECONDS)
        .until(() -> gestor("/api/v1/pagamentos", "loja-d").corpo().get("itens").size() == 3);

    Resposta comprador = chamar("/api/v1/pagamentos", "loja-d", "comprador");
    assertThat(comprador.status()).isEqualTo(403);
    assertThat(comprador.corpo().get("type").asText()).endsWith("/acesso-negado");
    assertThat(chamar("/api/v1/ledger/lancamentos", "loja-d", "comprador").status()).isEqualTo(403);
    assertThat(chamar("/api/v1/pagamentos", "loja-d", "plataforma-admin").status()).isEqualTo(200);

    String id =
        gestor("/api/v1/pagamentos", "loja-d").corpo().get("itens").get(0).get("id").asText();
    assertThat(gestor("/api/v1/pagamentos/" + id, "loja-d").status()).isEqualTo(200);
    assertThat(chamar("/api/v1/pagamentos/" + id, "loja-d", "comprador").status()).isEqualTo(403);
    assertThat(gestor("/api/v1/pagamentos/" + id, "loja-e").status()).isEqualTo(404);
    assertThat(gestor("/api/v1/pagamentos", "loja-e").corpo().get("itens")).isEmpty();

    Resposta p1 = gestor("/api/v1/pagamentos?limite=2", "loja-d");
    assertThat(p1.corpo().get("itens")).hasSize(2);
    Resposta p2 =
        gestor(
            "/api/v1/pagamentos?limite=2&cursor=" + p1.corpo().get("proximoCursor").asText(),
            "loja-d");
    assertThat(p2.corpo().get("itens")).hasSize(1);
    assertThat(p2.corpo().get("proximoCursor").isNull()).isTrue();

    Resposta l1 = gestor("/api/v1/ledger/lancamentos?limite=4", "loja-d");
    assertThat(l1.corpo().get("itens")).hasSize(4);
    assertThat(l1.corpo().get("saldo").get("centavos").asLong()).isEqualTo(600);
    Resposta l2 =
        gestor(
            "/api/v1/ledger/lancamentos?limite=4&cursor="
                + l1.corpo().get("proximoCursor").asText(),
            "loja-d");
    assertThat(l2.corpo().get("itens")).hasSize(2);

    assertThat(gestor("/api/v1/pagamentos?limite=0", "loja-d").status()).isEqualTo(400);
    assertThat(gestor("/api/v1/pagamentos?cursor=@@@", "loja-d").status()).isEqualTo(400);
    assertThat(gestor("/api/v1/pagamentos?status=PAGO", "loja-d").status()).isEqualTo(400);
    assertThat(gestor("/api/v1/ledger/lancamentos?moeda=real", "loja-d").status()).isEqualTo(400);
  }
}
