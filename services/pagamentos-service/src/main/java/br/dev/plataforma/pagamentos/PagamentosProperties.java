package br.dev.plataforma.pagamentos;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuração do pagamentos-service.
 *
 * @param limiteAprovacaoCentavos o gateway simulado aprova até este valor e recusa acima dele
 */
@ConfigurationProperties("plataforma.pagamentos")
public record PagamentosProperties(Long limiteAprovacaoCentavos) {

  public PagamentosProperties {
    limiteAprovacaoCentavos =
        limiteAprovacaoCentavos == null ? 1_000_000L : limiteAprovacaoCentavos;
  }
}
