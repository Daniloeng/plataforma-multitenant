package br.dev.plataforma.spring.outbox;

import java.time.Instant;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * Evento aguardando publicação no Pulsar. Gravado na mesma transação da mudança de estado
 * (ADR-0006); o {@link OutboxRelay} publica e preenche {@code publishedAt}.
 *
 * @param id o próprio eventId, para a gravação do outbox ser idempotente
 * @param tenantId tenant do evento
 * @param event nome do evento (ex.: tenant.criado)
 * @param topic tópico Pulsar de destino
 * @param key chave da mensagem ({@code tenantId:aggregateId}), que garante ordem por agregado
 * @param payload evento serializado em Avro binário
 * @param traceparent contexto de trace, se houver
 * @param occurredAt instante do fato
 * @param publishedAt instante da publicação; nulo enquanto pendente
 * @param attempts tentativas de publicação que falharam
 * @param lastError última falha, para diagnóstico
 */
@Document("outbox")
public record OutboxMessage(
    @Id String id,
    String tenantId,
    String event,
    String topic,
    String key,
    byte[] payload,
    String traceparent,
    Instant occurredAt,
    Instant publishedAt,
    int attempts,
    String lastError) {}
