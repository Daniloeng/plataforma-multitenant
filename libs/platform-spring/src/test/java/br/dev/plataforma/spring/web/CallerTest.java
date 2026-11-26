package br.dev.plataforma.spring.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.ServletWebRequest;

class CallerTest {

  @Test
  void leUsuarioPapeisEClienteDosCabecalhosDoGateway() {
    var req = new MockHttpServletRequest();
    req.addHeader("X-Usuario", " ana ");
    req.addHeader("X-Papeis", "gestor-tenant, comprador,,");
    req.addHeader("X-Cliente-Id", "cli-1");

    Caller caller = Caller.from(req);

    assertThat(caller.usuario()).isEqualTo("ana");
    assertThat(caller.papeis()).containsExactlyInAnyOrder("gestor-tenant", "comprador");
    assertThat(caller.clienteId()).isEqualTo("cli-1");
    assertThat(caller.canManage()).isTrue();
    caller.requireAnyRole(Caller.GESTOR);
  }

  @Test
  void semCabecalhosNaoTemPapelENemGerencia() {
    Caller caller = Caller.from(new MockHttpServletRequest());

    assertThat(caller.usuario()).isNull();
    assertThat(caller.clienteId()).isNull();
    assertThat(caller.papeis()).isEmpty();
    assertThat(caller.canManage()).isFalse();
    assertThat(new Caller(null, null, " ").papeis()).isEmpty();
  }

  @Test
  void compradorNaoPassaNaExigenciaDeGestor() {
    var req = new MockHttpServletRequest();
    req.addHeader("X-Papeis", "comprador");
    Caller caller = Caller.from(req);

    assertThat(caller.hasAnyRole(Caller.COMPRADOR)).isTrue();
    assertThatThrownBy(() -> caller.requireAnyRole(Caller.GESTOR, Caller.ADMIN))
        .isInstanceOf(ForbiddenException.class)
        .hasMessageContaining("gestor-tenant ou plataforma-admin");
  }

  @Test
  void adminGerencia() {
    var req = new MockHttpServletRequest();
    req.addHeader("X-Papeis", "plataforma-admin");
    assertThat(Caller.from(req).canManage()).isTrue();
  }

  static void comCaller(Caller caller) {}

  static void comTexto(String texto) {}

  @Test
  void resolverPreencheParametroCaller() throws Exception {
    var resolver = new CallerArgumentResolver();
    var comCaller =
        new MethodParameter(CallerTest.class.getDeclaredMethod("comCaller", Caller.class), 0);
    var comTexto =
        new MethodParameter(CallerTest.class.getDeclaredMethod("comTexto", String.class), 0);
    var req = new MockHttpServletRequest();
    req.addHeader("X-Usuario", "bruno");

    assertThat(resolver.supportsParameter(comCaller)).isTrue();
    assertThat(resolver.supportsParameter(comTexto)).isFalse();
    assertThat(
            resolver.resolveArgument(comCaller, null, new ServletWebRequest(req), null).usuario())
        .isEqualTo("bruno");
  }
}
