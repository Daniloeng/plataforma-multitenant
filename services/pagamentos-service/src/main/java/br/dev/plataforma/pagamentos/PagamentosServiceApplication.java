package br.dev.plataforma.pagamentos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/** Pagamentos: cobra os pedidos num gateway simulado e mantém o ledger de cada tenant. */
@SpringBootApplication
@ConfigurationPropertiesScan
public class PagamentosServiceApplication {

  public static void main(String[] args) {
    SpringApplication.run(PagamentosServiceApplication.class, args);
  }
}
