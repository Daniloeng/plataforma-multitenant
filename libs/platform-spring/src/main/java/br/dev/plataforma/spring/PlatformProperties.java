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
    events = events == null ? new Events(0) : events;
    tenancy = tenancy == null ? new Tenancy(null, null) : tenancy;
    outbox = outbox == null ? new OutboxProps(null, null, null, 0) : outbox;
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
   * @param sendTimeout tempo máximo de uma publicação (padrão: 5 s)
   * @param batchSize mensagens por ciclo (padrão: 100)
   */
  public record OutboxProps(
      Boolean enabled, Duration interval, Duration sendTimeout, int batchSize) {
    public OutboxProps {
      enabled = enabled == null ? Boolean.TRUE : enabled;
      interval = interval == null ? Duration.ofMillis(200) : interval;
      sendTimeout = sendTimeout == null ? Duration.ofSeconds(5) : sendTimeout;
      batchSize = batchSize <= 0 ? 100 : batchSize;
    }
  }

  /**
   * @param maxRedeliveries tentativas antes de mandar a mensagem para o dead letter (padrão: 10)
   */
  public record Events(int maxRedeliveries) {
    public Events {
      maxRedeliveries = maxRedeliveries <= 0 ? 10 : maxRedeliveries;
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
