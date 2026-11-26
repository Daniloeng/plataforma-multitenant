package br.dev.plataforma.status;

/**
 * Métricas de um serviço, lidas do {@code /actuator/prometheus} dele, acumuladas desde a subida.
 *
 * @param requests requisições HTTP atendidas (sem as do Actuator)
 * @param errorRate fração de respostas 5xx (0 a 1)
 * @param p99Ms p99 de latência em ms, pelo histograma; null sem requisições
 * @param outboxPending eventos esperando publicação; null se o serviço não tem outbox
 * @param outboxLagSeconds idade do pendente mais antigo, em segundos; null se não tem outbox
 * @param eventsConsumed eventos consumidos com sucesso; null se o serviço não consumiu nenhum
 * @param eventsFailed tentativas de consumo que falharam; null se o serviço não consumiu nenhum
 * @param outboxUnreadable o serviço tem outbox, mas não conseguiu contá-lo (MongoDB lento ou fora):
 *     pendentes e atraso vêm null, e isso não quer dizer "sem outbox"
 */
public record ServiceMetrics(
    long requests,
    double errorRate,
    Double p99Ms,
    Long outboxPending,
    Double outboxLagSeconds,
    Long eventsConsumed,
    Long eventsFailed,
    boolean outboxUnreadable) {}
