package br.dev.plataforma.pagamentos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class CursorTest {

  @Test
  void cursorIdaEVolta() {
    Cursor c = new Cursor(Instant.ofEpochMilli(1_700_000_000_123L), "pag-1");
    assertThat(Cursor.decodificar(c.codificar())).isEqualTo(c);
  }

  @Test
  void cursorInvalidoViraRequisicaoInvalida() {
    assertThatThrownBy(() -> Cursor.decodificar("@@@")).isInstanceOf(RequisicaoInvalida.class);
    assertThatThrownBy(() -> Cursor.decodificar("c2VtLXNlcGFyYWRvcg"))
        .isInstanceOf(RequisicaoInvalida.class);
  }
}
