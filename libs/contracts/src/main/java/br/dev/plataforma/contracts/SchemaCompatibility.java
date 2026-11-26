package br.dev.plataforma.contracts;

import java.util.List;
import org.apache.avro.Schema;
import org.apache.avro.SchemaCompatibility.SchemaCompatibilityType;
import org.apache.avro.SchemaCompatibility.SchemaPairCompatibility;

/**
 * Regra de evolução dos eventos: compatibilidade FULL, a mesma configurada nos namespaces do
 * Pulsar. BACKWARD (consumidor novo lê mensagem antiga) e FORWARD (consumidor antigo lê mensagem
 * nova), para que produtor e consumidor possam ser implantados em qualquer ordem.
 */
public final class SchemaCompatibility {

  private SchemaCompatibility() {}

  /** Problemas nas duas direções; lista vazia quando os schemas são totalmente compatíveis. */
  public static List<String> fullIssues(Schema current, Schema previous) {
    List<String> backward =
        backwardIssues(current, previous).stream().map(i -> "BACKWARD: " + i).toList();
    List<String> forward =
        backwardIssues(previous, current).stream().map(i -> "FORWARD: " + i).toList();
    return java.util.stream.Stream.concat(backward.stream(), forward.stream()).toList();
  }

  /**
   * Verifica se {@code current} lê dados gravados com {@code previous}.
   *
   * @return lista vazia se compatível; senão, a descrição de cada incompatibilidade
   */
  public static List<String> backwardIssues(Schema current, Schema previous) {
    SchemaPairCompatibility result =
        org.apache.avro.SchemaCompatibility.checkReaderWriterCompatibility(current, previous);
    if (result.getType() == SchemaCompatibilityType.COMPATIBLE) {
      return List.of();
    }
    return result.getResult().getIncompatibilities().stream()
        .map(i -> i.getType() + " em " + i.getLocation() + ": " + i.getMessage())
        .toList();
  }
}
