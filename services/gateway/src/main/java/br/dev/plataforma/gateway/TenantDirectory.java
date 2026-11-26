package br.dev.plataforma.gateway;

import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Catálogo de tenants em memória. Os eventos {@code tenant.criado} e {@code tenant.alterado} chegam
 * por tópicos diferentes, sem ordem entre si, e a listagem inicial pode chegar depois de um evento:
 * por isso cada entrada só é substituída por outra de {@code versao} maior (ADR-0008).
 */
public class TenantDirectory {

  private final Map<String, TenantInfo> tenants = new ConcurrentHashMap<>();
  private final AtomicBoolean loaded = new AtomicBoolean();

  /**
   * @return true se a entrada foi aceita (tenant novo ou versão maior)
   */
  public boolean apply(TenantInfo info) {
    boolean[] accepted = {false};
    tenants.compute(
        info.id(),
        (id, current) -> {
          if (current == null || info.versao() > current.versao()) {
            accepted[0] = true;
            return info;
          }
          return current;
        });
    return accepted[0];
  }

  public Optional<TenantInfo> find(String id) {
    return Optional.ofNullable(tenants.get(id));
  }

  /** Em ordem de id, como a listagem do tenant-service. */
  public List<TenantInfo> all() {
    Collection<TenantInfo> values = tenants.values();
    return values.stream().sorted(Comparator.comparing(TenantInfo::id)).toList();
  }

  /** A listagem inicial terminou: a partir daqui, tenant ausente é tenant inexistente. */
  public void markLoaded() {
    loaded.set(true);
  }

  public boolean isLoaded() {
    return loaded.get();
  }
}
