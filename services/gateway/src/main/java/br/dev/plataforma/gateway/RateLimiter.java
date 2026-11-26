package br.dev.plataforma.gateway;

import br.dev.plataforma.contracts.tenants.Plano;
import java.time.Clock;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Limite de requisições por tenant (token bucket em memória). Cada tenant tem um balde com {@code
 * burst} fichas, repostas a {@code perSecond} por segundo conforme o plano.
 *
 * <p>Fica na memória de cada réplica do gateway: com duas réplicas, o limite efetivo dobra. Para o
 * estudo (uma réplica até o Dia 10) basta; um limite global exigiria um armazenamento
 * compartilhado.
 */
public class RateLimiter {

  /** Resultado de uma tentativa: permitido ou não, fichas restantes e espera sugerida. */
  public record Decision(boolean allowed, int remaining, long retryAfterSeconds, int perSecond) {}

  private static final class Bucket {
    double tokens;
    long updatedAtNanos;
    int perSecond;
    int burst;
  }

  private final Map<Plano, GatewayProperties.Limit> limits;
  private final Clock clock;
  private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

  public RateLimiter(Map<Plano, GatewayProperties.Limit> limits, Clock clock) {
    this.limits = Map.copyOf(limits);
    this.clock = clock;
  }

  public Decision tryAcquire(String tenantId, Plano plano) {
    return tryAcquire(tenantId, limits.get(plano));
  }

  /** Balde com limite explícito (ex.: o de cada usuário nas chamadas sem tenant). */
  public Decision tryAcquire(String key, GatewayProperties.Limit limit) {
    long now = nanos();
    Bucket bucket =
        buckets.computeIfAbsent(
            key,
            id -> {
              Bucket b = new Bucket();
              b.tokens = limit.burst();
              b.updatedAtNanos = now;
              return b;
            });
    synchronized (bucket) {
      // O plano pode mudar (tenant.alterado): o balde passa a usar o limite novo.
      bucket.perSecond = limit.perSecond();
      bucket.burst = limit.burst();
      double elapsedSeconds = Math.max(0, now - bucket.updatedAtNanos) / 1e9;
      bucket.tokens = Math.min(bucket.burst, bucket.tokens + elapsedSeconds * bucket.perSecond);
      bucket.updatedAtNanos = now;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return new Decision(true, (int) bucket.tokens, 0, bucket.perSecond);
      }
      long retry = (long) Math.ceil((1 - bucket.tokens) / bucket.perSecond);
      return new Decision(false, 0, Math.max(1, retry), bucket.perSecond);
    }
  }

  private long nanos() {
    java.time.Instant i = clock.instant();
    return i.getEpochSecond() * 1_000_000_000L + i.getNano();
  }
}
