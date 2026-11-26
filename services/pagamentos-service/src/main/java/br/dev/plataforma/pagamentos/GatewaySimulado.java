package br.dev.plataforma.pagamentos;

import java.text.NumberFormat;
import java.util.Currency;
import java.util.Locale;
import org.springframework.stereotype.Component;

/**
 * Gateway de pagamento simulado (custo zero até o Dia 10): aprova até o limite configurado e recusa
 * acima dele. É determinístico, então a mesma chave sempre tem o mesmo resultado.
 */
@Component
public class GatewaySimulado implements GatewayPagamento {

  private final long limite;

  public GatewaySimulado(PagamentosProperties props) {
    this.limite = props.limiteAprovacaoCentavos();
  }

  @Override
  public Resultado autorizarECapturar(String chaveIdempotencia, long centavos, String moeda) {
    if (centavos > limite) {
      NumberFormat formato = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR"));
      try {
        formato.setCurrency(Currency.getInstance(moeda));
      } catch (IllegalArgumentException | NullPointerException e) {
        // moeda desconhecida: fica o símbolo do real, o limite é o mesmo em centavos
      }
      String valor = formato.format(limite / 100.0);
      return new Resultado(
          false,
          "Valor acima do limite de aprovação do gateway simulado ("
              + valor.replace(' ', ' ')
              + ").");
    }
    return new Resultado(true, null);
  }
}
