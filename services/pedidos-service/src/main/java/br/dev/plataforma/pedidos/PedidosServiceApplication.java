package br.dev.plataforma.pedidos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** Pedidos B2B: cria e cancela pedidos com o preço da cópia local do catálogo. */
@SpringBootApplication
public class PedidosServiceApplication {

  public static void main(String[] args) {
    SpringApplication.run(PedidosServiceApplication.class, args);
  }
}
