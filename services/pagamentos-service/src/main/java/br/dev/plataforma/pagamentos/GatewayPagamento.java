package br.dev.plataforma.pagamentos;

/**
 * Adquirente que autoriza e captura numa só chamada. A chave de idempotência faz uma repetição (a
 * transação do consumidor pode abortar depois da captura e o evento ser reprocessado) devolver o
 * mesmo resultado, sem cobrar de novo.
 */
public interface GatewayPagamento {

  Resultado autorizarECapturar(String chaveIdempotencia, long centavos, String moeda);

  /**
   * @param motivo preenchido quando recusado
   */
  record Resultado(boolean aprovado, String motivo) {}
}
