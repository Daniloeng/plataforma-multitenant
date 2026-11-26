package br.dev.plataforma.catalogo;

import br.dev.plataforma.contracts.tenants.Plano;
import java.util.EnumMap;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuração do catálogo ({@code plataforma.catalogo}).
 *
 * @param limites máximo de produtos (ativos e inativos) por plano do tenant
 */
@ConfigurationProperties("plataforma.catalogo")
public record CatalogoProperties(Map<Plano, Integer> limites) {

  public CatalogoProperties {
    Map<Plano, Integer> merged = new EnumMap<>(Plano.class);
    merged.put(Plano.GRATUITO, 20);
    merged.put(Plano.PROFISSIONAL, 500);
    merged.put(Plano.EMPRESARIAL, 10_000);
    if (limites != null) {
      merged.putAll(limites);
    }
    limites = Map.copyOf(merged);
  }

  public int limiteDe(Plano plano) {
    return limites.get(plano);
  }
}
