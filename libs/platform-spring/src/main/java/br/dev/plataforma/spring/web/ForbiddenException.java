package br.dev.plataforma.spring.web;

/** O papel de quem chamou não permite a operação; os serviços respondem 403 em Problem Details. */
public class ForbiddenException extends RuntimeException {

  public ForbiddenException(String message) {
    super(message);
  }
}
