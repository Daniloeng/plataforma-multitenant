package br.dev.plataforma.spring;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuração da biblioteca comum ({@code plataforma.*}).
 *
 * @param service contexto deste serviço, como em {@code x-produtor} (ex.: tenants); se informado, o
 *     outbox recusa eventos de outro produtor
 * @param tenancy regras do cabeçalho de tenant
 * @param outbox publicação de eventos
 * @param idempotency retenção dos registros de deduplicação e do outbox publicado
 * @param events consumo de eventos ({@code EventSubscriber})
 * @param isolation database por tenant nos níveis BRIDGE e SILO (ADR-0014)
 */
@ConfigurationProperties("plataforma")
public record PlatformProperties(
    String service,
    Tenancy tenancy,
    OutboxProps outbox,
    Idempotency idempotency,
    Events events,
    Isolation isolation) {

  public PlatformProperties {
    events = events == null ? new Events(0, 0) : events;
    tenancy = tenancy == null ? new Tenancy(null, null) : tenancy;
    outbox = outbox == null ? new OutboxProps(null, null, null, 0, null) : outbox;
    idempotency = idempotency == null ? new Idempotency(null) : idempotency;
    isolation = isolation == null ? new Isolation(false, null, null, null, null, null) : isolation;
  }

  /**
   * @param enabled liga o roteamento por tenant e a migração (padrão: false)
   * @param collections coleções de negócio que mudam de database com o tenant
   * @param refresh intervalo de releitura do mapa de isolamento (padrão: 1 s)
   * @param grace espera antes de copiar, para as outras réplicas pararem de gravar (padrão: 6 s);
   *     precisa ser maior que duas vezes o {@code refresh}: uma réplica que passa de {@code grace -
   *     refresh} sem reler o mapa recusa as operações dos tenants
   * @param lease sem batimento por esse tempo, outra réplica assume a migração (padrão: 1 min)
   * @param awaitTimeout de quanto em quanto tempo um consumidor que espera a migração registra no
   *     log (padrão: 2 min); ele segue esperando, sem nack
   */
  public record Isolation(
      boolean enabled,
      List<String> collections,
      Duration refresh,
      Duration grace,
      Duration lease,
      Duration awaitTimeout) {
    public Isolation {
      collections = collections == null ? List.of() : List.copyOf(collections);
      refresh = refresh == null ? Duration.ofSeconds(1) : refresh;
      grace = grace == null ? Duration.ofSeconds(6) : grace;
      lease = lease == null ? Duration.ofMinutes(1) : lease;
      awaitTimeout = awaitTimeout == null ? Duration.ofMinutes(2) : awaitTimeout;
      if (grace.compareTo(refresh.multipliedBy(2)) <= 0) {
        throw new IllegalArgumentException(
            "plataforma.isolation.grace ("
                + grace
                + ") precisa ser maior que duas vezes o refresh ("
                + refresh
                + ")");
      }
    }
  }

  /**
   * @param requiredPaths caminhos que exigem X-Tenant-Id (padrão: /api/v1/**)
   * @param excludedPaths exceções (ex.: a API administrativa de tenants)
   */
  public record Tenancy(List<String> requiredPaths, List<String> excludedPaths) {
    public Tenancy {
      requiredPaths = requiredPaths == null ? List.of("/api/v1/**") : List.copyOf(requiredPaths);
      excludedPaths = excludedPaths == null ? List.of() : List.copyOf(excludedPaths);
    }
  }

  /**
   * @param enabled liga o relay que publica o outbox (padrão: true)
   * @param interval intervalo entre ciclos do relay (padrão: 200 ms)
   * @param sendTimeout tempo máximo de uma publicação (padrão: 4 s, ou um terço de um lease curto;
   *     menor que metade do lease)
   * @param batchSize mensagens por ciclo (padrão: 100)
   * @param lease validade do lease do relay entre réplicas (padrão: 10 s; ADR-0015)
   */
  public record OutboxProps(
      Boolean enabled, Duration interval, Duration sendTimeout, int batchSize, Duration lease) {
    public OutboxProps {
      lease = lease == null ? Duration.ofSeconds(10) : lease;
      if (sendTimeout == null) {
        // Padrão de 4 s, mas sempre dentro da regra abaixo quando só o lease foi encurtado.
        Duration standard = Duration.ofSeconds(4);
        sendTimeout = standard.compareTo(lease.dividedBy(2)) < 0 ? standard : lease.dividedBy(3);
      }
      if (sendTimeout.compareTo(lease.dividedBy(2)) >= 0) {
        // Na primeira metade do prazo a dona publica sem consultar o lease: uma publicação
        // precisa caber nela, senão outra réplica assume no meio (ADR-0015).
        throw new IllegalArgumentException(
            "plataforma.outbox.send-timeout ("
                + sendTimeout
                + ") precisa ser menor que metade do plataforma.outbox.lease ("
                + lease
                + ")");
      }
      enabled = enabled == null ? Boolean.TRUE : enabled;
      interval = interval == null ? Duration.ofMillis(200) : interval;
      batchSize = batchSize <= 0 ? 100 : batchSize;
    }
  }

  /**
   * @param maxRedeliveries tentativas antes de mandar a mensagem para o dead letter (padrão: 10)
   * @param receiverQueueSize mensagens que cada consumidor busca adiantado (padrão: 1000, o do
   *     Pulsar). Serviço que escala pelo backlog (KEDA, ADR-0016) usa um valor pequeno: em
   *     Key_Shared, o que já foi entregue a uma réplica não passa para as que sobem depois.
   */
  public record Events(int maxRedeliveries, int receiverQueueSize) {
    public Events {
      maxRedeliveries = maxRedeliveries <= 0 ? 10 : maxRedeliveries;
      receiverQueueSize = receiverQueueSize <= 0 ? 1000 : receiverQueueSize;
    }
  }

  /**
   * @param retention por quanto tempo guardar eventos processados e publicados (padrão: 7 dias)
   */
  public record Idempotency(Duration retention) {
    public Idempotency {
      retention = retention == null ? Duration.ofDays(7) : retention;
    }
  }
}
