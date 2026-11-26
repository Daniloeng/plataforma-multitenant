package br.dev.plataforma.contracts;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.apache.avro.Schema;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Cada schema publicado (pasta {@code baseline/}) precisa continuar existindo e o schema atual
 * precisa ser FULL compatível com ele (BACKWARD e FORWARD). É o mesmo teste que o Schema Registry
 * do Pulsar faria ao receber o schema novo, só que no PR, antes de chegar ao broker.
 */
class BaselineCompatibilityTest {

  private static final Path BASELINE = Path.of("baseline");
  private static Map<String, Schema> atuais;

  @BeforeAll
  static void carregarAtuais() {
    atuais =
        EventCatalog.defaultCatalog().all().stream()
            .map(EventContract::schema)
            .collect(Collectors.toMap(Schema::getFullName, s -> s));
  }

  @TestFactory
  Stream<DynamicTest> schemaAtualLeMensagensDoBaseline() throws IOException {
    List<Schema> publicados = parseBaseline();
    assertThat(publicados).as("baseline vazio").isNotEmpty();
    return publicados.stream()
        .map(
            antigo ->
                DynamicTest.dynamicTest(
                    antigo.getFullName(),
                    () -> {
                      Schema atual = atuais.get(antigo.getFullName());
                      assertThat(atual)
                          .as("evento publicado foi removido: " + antigo.getFullName())
                          .isNotNull();
                      assertThat(SchemaCompatibility.fullIssues(atual, antigo)).isEmpty();
                    }));
  }

  /** Lê o baseline com um único parser: enums primeiro, depois os eventos que os referenciam. */
  private static List<Schema> parseBaseline() throws IOException {
    Schema.Parser parser = new Schema.Parser();
    List<Path> arquivos;
    try (Stream<Path> walk = Files.walk(BASELINE)) {
      arquivos = walk.filter(p -> p.toString().endsWith(".avsc")).sorted().toList();
    }
    List<Path> enums = arquivos.stream().filter(BaselineCompatibilityTest::isEnum).toList();
    for (Path p : enums) {
      parser.parse(p.toFile());
    }
    return arquivos.stream()
        .filter(p -> !enums.contains(p))
        .map(
            p -> {
              try {
                return parser.parse(p.toFile());
              } catch (IOException e) {
                throw new IllegalStateException(e);
              }
            })
        .toList();
  }

  private static boolean isEnum(Path p) {
    try {
      return Files.readString(p).contains("\"type\": \"enum\"")
          && !Files.readString(p).contains("\"type\": \"record\"");
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }
}
