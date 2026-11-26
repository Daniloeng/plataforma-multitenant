package br.dev.plataforma.pedidos;

import br.dev.plataforma.spring.tenancy.TenantContext;
import br.dev.plataforma.spring.web.Caller;
import br.dev.plataforma.spring.web.ForbiddenException;
import jakarta.validation.Valid;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * API de pedidos (pedidos.yaml). O tenant vem do X-Tenant-Id, o cliente do X-Cliente-Id e os papéis
 * do X-Papeis, todos escritos pelo gateway. Comprador cria e vê os pedidos do próprio cliente;
 * gestor-tenant (e plataforma-admin) vê e cancela os de todos os clientes do tenant.
 */
@RestController
@RequestMapping("/api/v1/pedidos")
public class PedidoController {

  static final String IDEMPOTENCY_KEY = "Idempotency-Key";
  static final String REPLAYED = "Idempotent-Replayed";

  private final PedidoService service;
  private final LinhaDoTempo linhaDoTempo;

  public PedidoController(PedidoService service, LinhaDoTempo linhaDoTempo) {
    this.service = service;
    this.linhaDoTempo = linhaDoTempo;
  }

  @PostMapping
  public ResponseEntity<PedidoView> criar(
      Caller caller,
      @RequestHeader(name = IDEMPOTENCY_KEY, required = false) String chave,
      @Valid @RequestBody NovoPedido req) {
    caller.requireAnyRole(Caller.COMPRADOR);
    if (caller.clienteId() == null) {
      throw new ForbiddenException(
          "Só compradores ligados a um cliente (claim cliente_id) criam pedidos.");
    }
    PedidoView.Criacao criacao = service.criar(caller.clienteId(), chave, req);
    PedidoView pedido = criacao.pedido();
    if (criacao.repetido()) {
      return ResponseEntity.status(HttpStatus.OK).header(REPLAYED, "true").body(pedido);
    }
    return ResponseEntity.created(URI.create("/api/v1/pedidos/" + pedido.id())).body(pedido);
  }

  @GetMapping
  public PedidoView.Pagina listar(
      Caller caller,
      @RequestParam(required = false) StatusPedido status,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "20") int limite) {
    return service.listar(clienteDe(caller), status, cursor, limite);
  }

  @GetMapping("/{pedidoId}")
  public PedidoView obter(Caller caller, @PathVariable String pedidoId) {
    return service.obter(pedidoId, clienteDe(caller));
  }

  /** Linha do tempo em tempo real (SSE): o estado atual e cada mudança do pedido (ADR-0013). */
  @GetMapping(path = "/{pedidoId}/linha-do-tempo", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter acompanhar(Caller caller, @PathVariable String pedidoId) {
    String cliente = clienteDe(caller);
    return linhaDoTempo.abrir(
        TenantContext.require().toString(),
        pedidoId,
        cliente == null,
        () -> service.documento(pedidoId, cliente));
  }

  @PostMapping("/{pedidoId}/cancelamento")
  public PedidoView cancelar(Caller caller, @PathVariable String pedidoId) {
    return service.cancelar(pedidoId, clienteDe(caller));
  }

  /**
   * Cliente que restringe a operação: null (todos) para gestor e admin, o próprio cliente para o
   * comprador. Sem nenhum dos dois, 403.
   */
  static String clienteDe(Caller caller) {
    if (caller.canManage()) {
      return null;
    }
    caller.requireAnyRole(Caller.COMPRADOR, Caller.GESTOR, Caller.ADMIN);
    if (caller.clienteId() == null) {
      throw new ForbiddenException("Comprador sem cliente (claim cliente_id) não vê pedidos.");
    }
    return caller.clienteId();
  }
}
