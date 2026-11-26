package br.dev.plataforma.status;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;

/**
 * Verifica o Pulsar pelo endpoint de health do broker ({@code /admin/v2/brokers/health}), que
 * produz e consome uma mensagem num tópico interno: se responde 200, o broker e o BookKeeper estão
 * funcionando.
 */
public class PulsarCheck extends HttpHealthCheck {

  static final String HEALTH_PATH = "admin/v2/brokers/health";

  public PulsarCheck(String name, URI adminUrl, Duration timeout) {
    this(name, adminUrl, timeout, newClient(timeout));
  }

  PulsarCheck(String name, URI adminUrl, Duration timeout, HttpClient http) {
    super(name, ComponentType.PULSAR, adminUrl, HEALTH_PATH, "broker saudável", timeout, http);
  }
}
