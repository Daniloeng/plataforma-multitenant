package br.dev.plataforma.spring.tenancy;

import br.dev.plataforma.core.TenantId;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.util.List;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UrlPathHelper;

/**
 * Lê {@code X-Tenant-Id} (obrigatório nos caminhos configurados) e {@code X-Cliente-Id} (opcional),
 * preenche o {@link TenantContext} e o MDC dos logs, e limpa tudo no fim da requisição. Cabeçalho
 * ausente ou inválido responde 400 em Problem Details, sem chegar ao controller.
 */
public class TenantContextFilter extends OncePerRequestFilter {

  public static final String TENANT_HEADER = "X-Tenant-Id";
  public static final String CLIENTE_HEADER = "X-Cliente-Id";

  private final List<String> requiredPaths;
  private final List<String> excludedPaths;
  private final ObjectMapper json;
  private final AntPathMatcher matcher = new AntPathMatcher();

  public TenantContextFilter(
      List<String> requiredPaths, List<String> excludedPaths, ObjectMapper json) {
    this.requiredPaths = List.copyOf(requiredPaths);
    this.excludedPaths = List.copyOf(excludedPaths);
    this.json = json;
  }

  private static final UrlPathHelper PATHS = new UrlPathHelper();

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    // Caminho decodificado e normalizado, o mesmo que o Spring MVC usa para rotear: com o URI cru,
    // /api/v%31/pedidos escaparia de /api/v1/** e chegaria ao controller sem tenant.
    String path = PATHS.getPathWithinApplication(request);
    return requiredPaths.stream().noneMatch(p -> matcher.match(p, path))
        || excludedPaths.stream().anyMatch(p -> matcher.match(p, path));
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String raw = request.getHeader(TENANT_HEADER);
    TenantId tenantId;
    try {
      tenantId = new TenantId(raw == null ? null : raw.strip());
    } catch (NullPointerException | IllegalArgumentException e) {
      reject(request, response, raw == null ? "Cabeçalho X-Tenant-Id ausente." : e.getMessage());
      return;
    }
    String clienteId = blankToNull(request.getHeader(CLIENTE_HEADER));
    MDC.put("tenantId", tenantId.value());
    try {
      TenantContext.callAs(
          tenantId,
          clienteId,
          () -> {
            chain.doFilter(request, response);
            return null;
          });
    } catch (IOException | ServletException | RuntimeException e) {
      throw e;
    } catch (Exception e) {
      throw new ServletException(e);
    } finally {
      MDC.remove("tenantId");
    }
  }

  private void reject(HttpServletRequest request, HttpServletResponse response, String detail)
      throws IOException {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, detail);
    problem.setTitle("Tenant inválido");
    problem.setType(URI.create("https://plataforma.dev.br/problemas/tenant-invalido"));
    problem.setInstance(URI.create(request.getRequestURI()));
    response.setStatus(HttpStatus.BAD_REQUEST.value());
    response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
    response.setCharacterEncoding("UTF-8");
    json.writeValue(response.getOutputStream(), problem);
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.strip();
  }
}
