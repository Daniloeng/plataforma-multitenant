package br.dev.plataforma.spring.events;

import br.dev.plataforma.contracts.EventCatalog;
import br.dev.plataforma.core.TenantId;
import br.dev.plataforma.spring.idempotency.IdempotentConsumer;
import br.dev.plataforma.spring.tenancy.TenantContext;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.apache.avro.generic.GenericRecord;
import org.apache.avro.specific.SpecificRecord;
import org.apache.pulsar.client.api.DeadLetterPolicy;
import org.apache.pulsar.client.api.Message;
import org.apache.pulsar.client.api.PulsarClient;
import org.apache.pulsar.client.api.PulsarClientException;
import org.apache.pulsar.client.api.Schema;
import org.apache.pulsar.client.api.SubscriptionInitialPosition;
import org.apache.pulsar.client.api.SubscriptionType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Consumidor padrão da plataforma. Para cada evento registrado com {@link #on}:
 *
 * <ul>
 *   <li>assinatura durável {@code <serviço>-<nome>}, {@code Key_Shared} (ordem por agregado, pela
 *       chave {@code tenantId:aggregateId}), começando do início do tópico;
 *   <li>decodifica com o schema do escritor ({@link EventDecoder});
 *   <li>roda o efeito numa transação MongoDB, com o tenant do evento no contexto, pelo {@link
 *       IdempotentConsumer} (reentrega não repete o efeito);
 *   <li>ack depois do commit; em erro, nack e nova tentativa em 1 s; depois de {@code
 *       maxRedeliveries} tentativas a mensagem vai para o tópico de dead letter da assinatura.
 * </ul>
 */
public class EventSubscriber implements SmartLifecycle {

  private static final Logger LOG = LoggerFactory.getLogger(EventSubscriber.class);

  private record Registration<T extends SpecificRecord>(
      Class<T> type, String name, Consumer<T> handler, boolean waitForTenant) {}

  /**
   * Espera o tenant ficar disponível antes do efeito (ex.: migração de nível em andamento,
   * ADR-0014); lança exceção se demorar, e a mensagem volta com nack.
   */
  @FunctionalInterface
  public interface TenantAwaiter {
    void awaitReady(TenantId tenant);
  }

  private final PulsarClient pulsar;
  private final EventCatalog catalog;
  private final EventDecoder decoder;
  private final IdempotentConsumer idempotent;
  private final TransactionTemplate tx;
  private final String service;
  private final int maxRedeliveries;
  private final List<Registration<?>> registrations = new CopyOnWriteArrayList<>();
  private final List<org.apache.pulsar.client.api.Consumer<byte[]>> consumers =
      new CopyOnWriteArrayList<>();
  private volatile boolean running;
  private volatile TenantAwaiter tenantAwaiter;
  private final TenantLanes lanes = new TenantLanes();

  public EventSubscriber(
      PulsarClient pulsar,
      EventCatalog catalog,
      EventDecoder decoder,
      IdempotentConsumer idempotent,
      TransactionTemplate tx,
      String service,
      int maxRedeliveries) {
    this.pulsar = pulsar;
    this.catalog = catalog;
    this.decoder = decoder;
    this.idempotent = idempotent;
    this.tx = tx;
    this.service = service;
    this.maxRedeliveries = maxRedeliveries;
  }

  /**
   * Registra um efeito para um tipo de evento. {@code name} identifica o consumidor na deduplicação
   * e na assinatura: mudá-lo reprocessa o tópico desde o início.
   */
  public <T extends SpecificRecord> EventSubscriber on(
      Class<T> type, String name, Consumer<T> handler) {
    return register(new Registration<>(type, name, handler, true));
  }

  /**
   * Como {@link #on}, para consumidores da própria plataforma que não tocam dados de negócio do
   * tenant (ex.: o que agenda a migração de nível): não esperam o tenant ficar disponível.
   */
  public <T extends SpecificRecord> EventSubscriber onPlatform(
      Class<T> type, String name, Consumer<T> handler) {
    return register(new Registration<>(type, name, handler, false));
  }

  /** Liga a espera pelo tenant disponível antes de cada efeito registrado com {@link #on}. */
  public void setTenantAwaiter(TenantAwaiter awaiter) {
    this.tenantAwaiter = awaiter;
  }

  private <T extends SpecificRecord> EventSubscriber register(Registration<T> registration) {
    if (service == null || service.isBlank()) {
      throw new IllegalStateException(
          "Defina plataforma.service: ele dá nome às assinaturas do consumidor.");
    }
    registrations.add(registration);
    if (running) {
      subscribe(registration);
    }
    return this;
  }

  String subscriptionName(String name) {
    return service + "-" + name;
  }

  /**
   * Dead letter no namespace do serviço consumidor, no padrão dos demais tópicos (ADR-0010): {@code
   * persistent://plataforma/<serviço>/dlq.<assinatura>}.
   */
  String deadLetterTopic(String name) {
    return "persistent://plataforma/" + service + "/dlq." + subscriptionName(name);
  }

  private <T extends SpecificRecord> void subscribe(Registration<T> r) {
    String topic = catalog.of(r.type()).topic();
    try {
      consumers.add(
          pulsar
              .newConsumer(Schema.BYTES)
              .topic(topic)
              .subscriptionName(subscriptionName(r.name()))
              .subscriptionType(SubscriptionType.Key_Shared)
              .subscriptionInitialPosition(SubscriptionInitialPosition.Earliest)
              .negativeAckRedeliveryDelay(1, TimeUnit.SECONDS)
              .deadLetterPolicy(
                  DeadLetterPolicy.builder()
                      .maxRedeliverCount(maxRedeliveries)
                      .deadLetterTopic(deadLetterTopic(r.name()))
                      // Assinatura criada junto com o tópico: retém as mensagens até alguém
                      // reprocessar, em vez de perdê-las na retenção do namespace.
                      .initialSubscriptionName(subscriptionName(r.name()) + "-reprocessar")
                      .build())
              .messageListener((consumer, msg) -> handle(consumer, msg, r))
              // Uma fila por tenant: esperar a migração de um tenant não segura os outros, e a
              // ordem por chave (tenantId:agregado) se mantém.
              .messageListenerExecutor(lanes::execute)
              .subscribe());
      LOG.info("Consumindo {} como {}", topic, subscriptionName(r.name()));
    } catch (PulsarClientException e) {
      throw new IllegalStateException("Não foi possível assinar " + topic, e);
    }
  }

  <T extends SpecificRecord> void handle(
      org.apache.pulsar.client.api.Consumer<byte[]> consumer,
      Message<byte[]> msg,
      Registration<T> r) {
    try {
      process(msg, r);
      consumer.acknowledgeAsync(msg);
    } catch (Throwable e) { // Error também: sem nack, a mensagem ficaria pendente para sempre
      LOG.warn(
          "Falha ao processar {} ({}), tentativa {}: {}",
          msg.getTopicName(),
          msg.getMessageId(),
          msg.getRedeliveryCount() + 1,
          e.toString());
      consumer.negativeAcknowledge(msg);
    }
  }

  /**
   * Decodifica e aplica o efeito uma vez só. Devolve false se o evento já tinha sido processado.
   */
  <T extends SpecificRecord> boolean process(Message<byte[]> msg, Registration<T> r) {
    T event = decoder.decode(msg, r.type());
    GenericRecord generic = (GenericRecord) event;
    TenantId tenant = TenantId.of(String.valueOf(generic.get("tenantId")));
    String eventId = String.valueOf(generic.get("eventId"));
    TenantAwaiter awaiter = tenantAwaiter;
    if (r.waitForTenant() && awaiter != null) {
      awaiter.awaitReady(tenant);
    }
    Boolean done =
        tx.execute(
            status ->
                TenantContext.callAsUnchecked(
                    tenant,
                    () ->
                        idempotent.processOnce(
                            tenant, r.name(), eventId, () -> r.handler().accept(event))));
    return Boolean.TRUE.equals(done);
  }

  @Override
  public void start() {
    running = true;
    registrations.forEach(this::subscribe);
  }

  @Override
  public void stop() {
    running = false;
    // Fecha sem esperar o broker indefinidamente: no desligamento ele pode já estar fora do ar.
    for (var c : consumers) {
      try {
        c.closeAsync().get(2, TimeUnit.SECONDS);
      } catch (Exception e) {
        if (e instanceof InterruptedException) {
          Thread.currentThread().interrupt();
        }
        LOG.debug("Consumidor não fechou a tempo", e);
      }
    }
    consumers.clear();
    lanes.close();
  }

  @Override
  public boolean isRunning() {
    return running;
  }
}
