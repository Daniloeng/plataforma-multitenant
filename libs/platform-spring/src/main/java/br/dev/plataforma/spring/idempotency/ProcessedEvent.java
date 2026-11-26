package br.dev.plataforma.spring.idempotency;

import java.time.Instant;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * Registro de que um consumidor já processou um evento. Índice único em (tenantId, consumer,
 * eventId) e TTL em processedAt (ver {@link IdempotencyIndexes}).
 */
@Document("processed_events")
public record ProcessedEvent(
    @Id String id, String tenantId, String consumer, String eventId, Instant processedAt) {}
