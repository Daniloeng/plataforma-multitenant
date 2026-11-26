package br.dev.plataforma.spring.isolation;

import java.util.function.Supplier;

/**
 * Marca um trecho que usa a database padrão do serviço mesmo com um tenant no contexto: outbox,
 * deduplicação de eventos e outras coleções da plataforma não migram com o tenant (ADR-0014). Sem
 * isolamento ligado, não muda nada.
 */
public final class PlatformDatabase {

  private static final ThreadLocal<Integer> DEPTH = ThreadLocal.withInitial(() -> 0);

  private PlatformDatabase() {}

  /** Roda {@code action} na database padrão e devolve o resultado. */
  public static <T> T call(Supplier<T> action) {
    DEPTH.set(DEPTH.get() + 1);
    try {
      return action.get();
    } finally {
      int depth = DEPTH.get() - 1;
      if (depth == 0) {
        DEPTH.remove();
      } else {
        DEPTH.set(depth);
      }
    }
  }

  /** Roda {@code action} na database padrão. */
  public static void run(Runnable action) {
    call(
        () -> {
          action.run();
          return null;
        });
  }

  /** Se a thread atual está num trecho da plataforma. */
  public static boolean active() {
    return DEPTH.get() > 0;
  }
}
