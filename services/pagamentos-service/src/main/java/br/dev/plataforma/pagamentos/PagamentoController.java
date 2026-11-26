package br.dev.plataforma.pagamentos;

import br.dev.plataforma.spring.web.Caller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * API de pagamentos e do ledger (pagamentos.yaml), só de leitura: a cobrança acontece pelos
 * eventos. Só gestor-tenant e plataforma-admin veem o financeiro do tenant.
 */
@RestController
@RequestMapping("/api/v1")
public class PagamentoController {

  private final ConsultaService consultas;

  public PagamentoController(ConsultaService consultas) {
    this.consultas = consultas;
  }

  @GetMapping("/pagamentos")
  public Views.PaginaPagamentos listar(
      Caller caller,
      @RequestParam(required = false) String pedidoId,
      @RequestParam(required = false) StatusPagamento status,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "20") int limite) {
    caller.requireAnyRole(Caller.GESTOR, Caller.ADMIN);
    return consultas.listar(pedidoId, status, cursor, limite);
  }

  @GetMapping("/pagamentos/{pagamentoId}")
  public Views.PagamentoView obter(Caller caller, @PathVariable String pagamentoId) {
    caller.requireAnyRole(Caller.GESTOR, Caller.ADMIN);
    return consultas.obter(pagamentoId);
  }

  @GetMapping("/ledger/lancamentos")
  public Views.Extrato extrato(
      Caller caller,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "20") int limite) {
    caller.requireAnyRole(Caller.GESTOR, Caller.ADMIN);
    return consultas.extrato(cursor, limite);
  }
}
