package br.dev.plataforma.spring.tenancy;

import br.dev.plataforma.core.TenantId;
import java.util.Optional;
import java.util.concurrent.Callable;

/**
 * Tenant (e cliente, quando houver) da requisição ou do evento em processamento.
 *
 * <p>Preenchido pelo {@link TenantContextFilter} a partir dos cabeçalhos que o gateway injeta, ou
 * por {@link #callAs} ao processar um evento. Código de negócio usa {@link #require()}: sem tenant,
 * a operação falha em vez de acessar dados de todos os tenants.
 */
public final class TenantContext {

  private static final ThreadLocal<Scope> CURRENT = new ThreadLocal<>();

  private TenantContext() {}

  /** Tenant e cliente de uma execução. */
  public record Scope(TenantId tenantId, String clienteId) {}

  /** Tenant atual, se houver. */
  public static Optional<TenantId> current() {
    Scope scope = CURRENT.get();
    return scope == null ? Optional.empty() : Optional.of(scope.tenantId());
  }

  /** Tenant atual; lança {@link MissingTenantException} se não houver. */
  public static TenantId require() {
    return current().orElseThrow(MissingTenantException::new);
  }

  /** Cliente comprador atual (cabeçalho X-Cliente-Id), se houver. */
  public static Optional<String> clienteId() {
    Scope scope = CURRENT.get();
    return scope == null ? Optional.empty() : Optional.ofNullable(scope.clienteId());
  }

  /** Executa {@code action} com o tenant informado e restaura o contexto anterior no final. */
  public static <T> T callAs(TenantId tenantId, String clienteId, Callable<T> action)
      throws Exception {
    Scope previous = CURRENT.get();
    CURRENT.set(new Scope(tenantId, clienteId));
    try {
      return action.call();
    } finally {
      if (previous == null) {
        CURRENT.remove();
      } else {
        CURRENT.set(previous);
      }
    }
  }

  /** Versão sem retorno e sem exceção checada de {@link #callAs}. */
  public static void runAs(TenantId tenantId, Runnable action) {
    try {
      callAs(
          tenantId,
          null,
          () -> {
            action.run();
            return null;
          });
    } catch (RuntimeException e) {
      throw e;
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
