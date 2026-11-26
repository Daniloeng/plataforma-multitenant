package br.dev.plataforma.catalogo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/** Catálogo: produtos e preços de cada tenant, produtor de produto.alterado e preco.alterado. */
@SpringBootApplication
@ConfigurationPropertiesScan
public class CatalogoServiceApplication {

  public static void main(String[] args) {
    SpringApplication.run(CatalogoServiceApplication.class, args);
  }
}
