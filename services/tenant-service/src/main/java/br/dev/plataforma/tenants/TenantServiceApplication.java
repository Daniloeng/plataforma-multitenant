package br.dev.plataforma.tenants;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** Cadastro de tenants: dono do catálogo de tenants e produtor de tenant.criado/tenant.alterado. */
@SpringBootApplication
@org.springframework.scheduling.annotation.EnableScheduling
public class TenantServiceApplication {

  public static void main(String[] args) {
    SpringApplication.run(TenantServiceApplication.class, args);
  }
}
