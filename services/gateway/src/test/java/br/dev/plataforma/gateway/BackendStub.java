package br.dev.plataforma.gateway;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Faz o papel de um serviço atrás do gateway: responde com os cabeçalhos de identidade que recebeu
 * e, em {@code GET /api/v1/tenants}, com uma página fixa (a carga inicial do catálogo).
 */
final class BackendStub implements AutoCloseable {

  final HttpServer server;
  final Map<String, String> lastHeaders = new ConcurrentHashMap<>();
  volatile String tenantsPage = "{\"itens\":[],\"proximoCursor\":null}";

  BackendStub() {
    try {
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    server.createContext(
        "/",
        exchange -> {
          lastHeaders.clear();
          for (String h : TenantAccessFilter.IDENTITY_HEADERS) {
            String v = exchange.getRequestHeaders().getFirst(h);
            lastHeaders.put(h, v == null ? "<ausente>" : v);
          }
          lastHeaders.put("path", exchange.getRequestURI().toString());
          String chave = exchange.getRequestHeaders().getFirst("Idempotency-Key");
          lastHeaders.put("Idempotency-Key", chave == null ? "<ausente>" : chave);
          String body =
              exchange.getRequestURI().getPath().equals("/api/v1/tenants")
                  ? tenantsPage
                  : "{\"ok\":true}";
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "application/json");
          exchange.sendResponseHeaders(200, bytes.length);
          exchange.getResponseBody().write(bytes);
          exchange.close();
        });
    server.start();
  }

  String url() {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  @Override
  public void close() {
    server.stop(0);
  }
}
