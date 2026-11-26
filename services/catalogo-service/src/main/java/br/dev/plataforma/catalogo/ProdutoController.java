package br.dev.plataforma.catalogo;

import br.dev.plataforma.spring.web.Caller;
import jakarta.validation.Valid;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * API do catálogo (catalogo.yaml). O tenant vem do X-Tenant-Id (filtro da biblioteca comum) e os
 * papéis do X-Papeis, ambos escritos pelo gateway. Escrita exige gestor-tenant ou plataforma-admin;
 * comprador só lê produtos ativos.
 */
@RestController
@RequestMapping("/api/v1/produtos")
public class ProdutoController {

  private final ProdutoService service;

  public ProdutoController(ProdutoService service) {
    this.service = service;
  }

  @GetMapping
  public ProdutoView.Pagina listar(
      Caller caller,
      @RequestParam(required = false) String busca,
      @RequestParam(required = false) Boolean ativo,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "20") int limite) {
    Boolean filtro = caller.canManage() ? ativo : Boolean.TRUE;
    return service.listar(busca, filtro, cursor, limite);
  }

  @PostMapping
  public ResponseEntity<ProdutoView> criar(Caller caller, @Valid @RequestBody NovoProduto req) {
    caller.requireAnyRole(Caller.GESTOR, Caller.ADMIN);
    ProdutoView criado = service.criar(req);
    return ResponseEntity.created(URI.create("/api/v1/produtos/" + criado.id())).body(criado);
  }

  @GetMapping("/{produtoId}")
  public ProdutoView obter(Caller caller, @PathVariable String produtoId) {
    return service.obter(produtoId, caller.canManage());
  }

  @PatchMapping("/{produtoId}")
  public ProdutoView alterar(
      Caller caller, @PathVariable String produtoId, @Valid @RequestBody AlteracaoProduto req) {
    caller.requireAnyRole(Caller.GESTOR, Caller.ADMIN);
    return service.alterar(produtoId, req);
  }

  @PutMapping("/{produtoId}/preco")
  public ProdutoView alterarPreco(
      Caller caller, @PathVariable String produtoId, @Valid @RequestBody Dinheiro preco) {
    caller.requireAnyRole(Caller.GESTOR, Caller.ADMIN);
    return service.alterarPreco(produtoId, preco);
  }
}
