package br.dev.plataforma.contracts;

import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.avro.util.ClassSecurityValidator;
import org.apache.avro.util.ClassSecurityValidator.ClassSecurityPredicate;

/**
 * O Avro 1.12 só instancia classes confiáveis ao desserializar. Este utilitário acrescenta as
 * classes geradas deste módulo à lista global, sem perder as que o Avro já confia por padrão nem as
 * configuradas por propriedade de sistema.
 *
 * <p>É chamado na inicialização do {@link EventCatalog}, então qualquer serviço que use o catálogo
 * já pode ler os eventos.
 */
public final class AvroTrust {

  static final String PACKAGE_PREFIX = "br.dev.plataforma.contracts.";

  private static final AtomicBoolean INSTALLED = new AtomicBoolean();

  private AvroTrust() {}

  /** Passa a confiar nas classes de eventos. Idempotente. */
  public static void trustContracts() {
    if (INSTALLED.compareAndSet(false, true)) {
      ClassSecurityPredicate contracts = type -> type.getName().startsWith(PACKAGE_PREFIX);
      ClassSecurityValidator.setGlobal(
          ClassSecurityValidator.composite(ClassSecurityValidator.getGlobal(), contracts));
    }
  }
}
