package br.dev.plataforma.pedidos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import br.dev.plataforma.spring.web.Caller;
import br.dev.plataforma.spring.web.ForbiddenException;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class PedidoServiceTest {

  @Test
  void hashDependeDeProdutosQuantidadesEOrdem() {
    NovoPedido a =
        new NovoPedido(List.of(new NovoPedido.Item("p1", 2), new NovoPedido.Item("p2", 1)));
    NovoPedido igual =
        new NovoPedido(List.of(new NovoPedido.Item("p1", 2), new NovoPedido.Item("p2", 1)));
    NovoPedido outraQuantidade =
        new NovoPedido(List.of(new NovoPedido.Item("p1", 3), new NovoPedido.Item("p2", 1)));
    assertThat(PedidoService.hash(a)).isEqualTo(PedidoService.hash(igual)).hasSize(64);
    assertThat(PedidoService.hash(a)).isNotEqualTo(PedidoService.hash(outraQuantidade));
  }

  @Test
  void cursorIdaEVolta() {
    var cursor = new PedidoService.Cursor(Instant.ofEpochMilli(1_700_000_000_123L), "abc|def");
    assertThat(PedidoService.Cursor.decodificar(cursor.codificar())).isEqualTo(cursor);
    assertThatThrownBy(() -> PedidoService.Cursor.decodificar("c2VtLXNlcGFyYWRvcg"))
        .isInstanceOf(PedidosExceptions.RequisicaoInvalida.class);
    assertThatThrownBy(() -> PedidoService.Cursor.decodificar("eHx5"))
        .isInstanceOf(PedidosExceptions.RequisicaoInvalida.class);
  }

  @Test
  void chaveAceitaUuidERecusaCurtaOuComEspaco() {
    assertThat(PedidoService.CHAVE.matcher("3f2b6c1e-8a1d-4c55-9b2f-0d8e7a6b5c4d").matches())
        .isTrue();
    assertThat(PedidoService.CHAVE.matcher("1234567").matches()).isFalse();
    assertThat(PedidoService.CHAVE.matcher("com espaco no meio").matches()).isFalse();
    assertThat(PedidoService.CHAVE.matcher("x".repeat(65)).matches()).isFalse();
  }

  @Test
  void escopoDoCliente() {
    assertThat(PedidoController.clienteDe(new Caller("ana", Set.of(Caller.GESTOR), null))).isNull();
    assertThat(PedidoController.clienteDe(new Caller("adm", Set.of(Caller.ADMIN), "c"))).isNull();
    assertThat(PedidoController.clienteDe(new Caller("bruno", Set.of(Caller.COMPRADOR), "c1")))
        .isEqualTo("c1");
    assertThatThrownBy(
            () -> PedidoController.clienteDe(new Caller("x", Set.of(Caller.COMPRADOR), null)))
        .isInstanceOf(ForbiddenException.class);
    assertThatThrownBy(() -> PedidoController.clienteDe(new Caller("x", Set.of(), "c1")))
        .isInstanceOf(ForbiddenException.class);
  }

  @Test
  void produtoLocalSoFicaDisponivelComAsDuasMetades() {
    ProdutoLocal p = new ProdutoLocal("t", "p");
    assertThat(p.disponivel()).isFalse();
    assertThat(p.aplicarPreco("SKU", 100, "BRL", 0)).isTrue();
    assertThat(p.getSku()).isEqualTo("SKU");
    assertThat(p.disponivel()).isFalse();
    assertThat(p.aplicarProduto("SKU-2", "Nome", true, 0)).isTrue();
    assertThat(p.disponivel()).isTrue();
    assertThat(p.aplicarProduto("SKU-2", "Velho", false, 0)).isFalse();
    assertThat(p.aplicarPreco("SKU-2", 1, "BRL", 0)).isFalse();
    assertThat(p.getNome()).isEqualTo("Nome");
    assertThat(p.getPrecoCentavos()).isEqualTo(100);
  }
}
