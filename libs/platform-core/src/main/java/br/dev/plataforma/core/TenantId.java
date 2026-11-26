package br.dev.plataforma.core;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Identificador de um tenant da plataforma.
 *
 * <p>É um slug em minúsculas (letras, dígitos e hífen, de 3 a 40 caracteres, começando por letra),
 * porque o mesmo valor vira nome de database no MongoDB (nível Bridge) e de namespace no Pulsar
 * ({@code plataforma/t-<id>}). Validar aqui evita que um id inválido chegue a essas camadas.
 */
public record TenantId(String value) {

  private static final Pattern FORMAT = Pattern.compile("^[a-z][a-z0-9-]{1,38}[a-z0-9]$");

  public TenantId {
    Objects.requireNonNull(value, "tenantId é obrigatório");
    if (!FORMAT.matcher(value).matches()) {
      throw new IllegalArgumentException(
          "tenantId inválido: '"
              + value
              + "'. Use de 3 a 40 caracteres: letras minúsculas, dígitos e hífen,"
              + " começando por letra e sem terminar em hífen.");
    }
    if (value.contains("--")) {
      throw new IllegalArgumentException(
          "tenantId inválido: '" + value + "'. Hífens consecutivos não são permitidos.");
    }
  }

  /**
   * Cria um {@link TenantId} a partir de texto informado pelo usuário, ignorando espaços e caixa.
   */
  public static TenantId of(String raw) {
    Objects.requireNonNull(raw, "tenantId é obrigatório");
    return new TenantId(raw.strip().toLowerCase(java.util.Locale.ROOT));
  }

  /** Namespace Pulsar dedicado, usado pelos níveis Bridge e Silo. */
  public String pulsarNamespace() {
    return "plataforma/t-" + value;
  }

  @Override
  public String toString() {
    return value;
  }
}
