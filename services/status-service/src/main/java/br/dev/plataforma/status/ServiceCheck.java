package br.dev.plataforma.status;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;

/**
 * Verifica um microsserviço da plataforma pela readiness do Actuator ({@code
 * /actuator/health/readiness}): 200 significa que ele subiu e as dependências dele responderam.
 */
public class ServiceCheck extends HttpHealthCheck {

  static final String HEALTH_PATH = "actuator/health/readiness";

  public ServiceCheck(String name, URI baseUrl, Duration timeout) {
    this(name, baseUrl, HEALTH_PATH, timeout, newClient(timeout));
  }

  public ServiceCheck(String name, URI baseUrl, String healthPath, Duration timeout) {
    this(name, baseUrl, healthPath, timeout, newClient(timeout));
  }

  ServiceCheck(String name, URI baseUrl, Duration timeout, HttpClient http) {
    this(name, baseUrl, HEALTH_PATH, timeout, http);
  }

  ServiceCheck(String name, URI baseUrl, String healthPath, Duration timeout, HttpClient http) {
    super(name, ComponentType.SERVICE, baseUrl, healthPath, "readiness UP", timeout, http);
  }
}
