package br.dev.plataforma.spring.events;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.apache.pulsar.client.api.Message;

/**
 * Executa o efeito de cada mensagem numa fila serial do tenant dela (thread virtual). A chave da
 * mensagem é {@code tenantId:agregado}, então mensagens da mesma chave seguem em ordem, e um tenant
 * que espera (migração de nível, ADR-0014) não segura os outros. Cada assinatura tem a sua
 * instância, para um consumidor que espera não segurar outro do mesmo tenant.
 *
 * <p>A fila não tem limite: o consumidor do Pulsar já limita as mensagens em voo pela {@code
 * receiverQueueSize}, então o que se acumula aqui é no máximo essa fila (dívida anotada no
 * ADR-0014).
 */
final class TenantLanes {

  private final String subscription;

  TenantLanes(String subscription) {
    this.subscription = subscription;
  }

  private final Map<String, ExecutorService> lanes = new ConcurrentHashMap<>();

  void execute(Message<?> message, Runnable task) {
    lanes
        .computeIfAbsent(
            tenantOf(message.getKey()),
            t ->
                Executors.newSingleThreadExecutor(
                    Thread.ofVirtual().name("evento-" + subscription + "-" + t).factory()))
        .execute(task);
  }

  static String tenantOf(String key) {
    if (key == null) {
      return "";
    }
    int sep = key.indexOf(':');
    return sep < 0 ? key : key.substring(0, sep);
  }

  int size() {
    return lanes.size();
  }

  void close() {
    lanes.values().forEach(ExecutorService::shutdownNow);
    lanes.clear();
  }
}
