package br.dev.plataforma.status;

import java.util.function.Supplier;

/** Verificação controlada pelos testes. */
class FakeCheck implements ComponentCheck, AutoCloseable {

  private final String name;
  private final Supplier<ComponentStatus> result;
  boolean closed;

  FakeCheck(String name, Supplier<ComponentStatus> result) {
    this.name = name;
    this.result = result;
  }

  static FakeCheck up(String name) {
    return new FakeCheck(name, () -> ComponentStatus.up(name, ComponentType.MONGODB, 1, null));
  }

  @Override
  public String name() {
    return name;
  }

  @Override
  public ComponentType type() {
    return ComponentType.MONGODB;
  }

  @Override
  public ComponentStatus check() {
    return result.get();
  }

  @Override
  public void close() {
    closed = true;
  }
}
