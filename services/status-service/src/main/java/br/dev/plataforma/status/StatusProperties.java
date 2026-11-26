package br.dev.plataforma.status;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Configuração do status-service ({@code plataforma.status.*}).
 *
 * @param timeout tempo máximo de cada verificação
 * @param mongo instâncias MongoDB, uma por microsserviço
 * @param pulsar endereço do admin HTTP do Pulsar
 */
@Validated
@ConfigurationProperties("plataforma.status")
public record StatusProperties(
    @NotNull Duration timeout, @Valid List<MongoTarget> mongo, @Valid PulsarTarget pulsar) {

  public StatusProperties {
    mongo = mongo == null ? List.of() : List.copyOf(mongo);
  }

  /** Uma instância MongoDB a verificar. */
  public record MongoTarget(@NotBlank String name, @NotBlank String uri) {}

  /** O Pulsar a verificar, pelo admin HTTP. */
  public record PulsarTarget(@NotBlank String name, @NotNull URI adminUrl) {}
}
