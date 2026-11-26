package br.dev.plataforma.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Porta de entrada da plataforma: valida o token do Keycloak, resolve o tenant da requisição,
 * aplica o limite do plano e encaminha para os serviços com os cabeçalhos de identidade.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class GatewayApplication {

  public static void main(String[] args) {
    SpringApplication.run(GatewayApplication.class, args);
  }
}
