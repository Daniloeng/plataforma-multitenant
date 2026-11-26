package br.dev.plataforma.status;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Predicate;

/**
 * Lê o formato de texto do Prometheus (o do {@code /actuator/prometheus}) e calcula as métricas que
 * a página de saúde mostra. Só o necessário: amostras com rótulos e valor, sem tipos nem exemplars.
 */
final class PrometheusText {

  /** Uma amostra: nome, rótulos e valor. */
  record Sample(String name, Map<String, String> labels, double value) {}

  private final List<Sample> samples;

  private PrometheusText(List<Sample> samples) {
    this.samples = samples;
  }

  static PrometheusText parse(String text) {
    List<Sample> samples = new ArrayList<>();
    for (String raw : text.split("\n")) {
      String line = raw.strip();
      if (line.isEmpty() || line.startsWith("#")) {
        continue;
      }
      Sample s = parseLine(line);
      if (s != null) {
        samples.add(s);
      }
    }
    return new PrometheusText(samples);
  }

  private static Sample parseLine(String line) {
    int brace = line.indexOf('{');
    int space;
    String name;
    Map<String, String> labels = new HashMap<>();
    if (brace >= 0) {
      name = line.substring(0, brace);
      int end = line.lastIndexOf('}');
      if (end < brace) {
        return null;
      }
      parseLabels(line.substring(brace + 1, end), labels);
      space = end + 1;
    } else {
      space = line.indexOf(' ');
      if (space < 0) {
        return null;
      }
      name = line.substring(0, space);
    }
    String[] rest = line.substring(space).strip().split("\\s+");
    try {
      return new Sample(name, labels, Double.parseDouble(rest[0]));
    } catch (NumberFormatException e) {
      return null;
    }
  }

  private static void parseLabels(String body, Map<String, String> labels) {
    int i = 0;
    while (i < body.length()) {
      int eq = body.indexOf('=', i);
      if (eq < 0 || eq + 1 >= body.length() || body.charAt(eq + 1) != '"') {
        return;
      }
      String key = body.substring(i, eq).strip();
      StringBuilder value = new StringBuilder();
      int j = eq + 2;
      while (j < body.length() && body.charAt(j) != '"') {
        char c = body.charAt(j);
        if (c == '\\' && j + 1 < body.length()) {
          j++;
          c = body.charAt(j) == 'n' ? '\n' : body.charAt(j);
        }
        value.append(c);
        j++;
      }
      labels.put(key, value.toString());
      i = j + 1;
      while (i < body.length() && (body.charAt(i) == ',' || body.charAt(i) == ' ')) {
        i++;
      }
    }
  }

  List<Sample> samples() {
    return samples;
  }

  boolean has(String name) {
    return samples.stream().anyMatch(s -> s.name().equals(name));
  }

  double sum(String name, Predicate<Map<String, String>> filter) {
    return samples.stream()
        .filter(s -> s.name().equals(name) && filter.test(s.labels()))
        .mapToDouble(Sample::value)
        .sum();
  }

  /**
   * Quantil de um histograma somando as séries que passam no filtro, com interpolação linear dentro
   * do balde, como o {@code histogram_quantile} do Prometheus. Null sem observações.
   */
  Double quantile(String bucketName, double q, Predicate<Map<String, String>> filter) {
    TreeMap<Double, Double> cumulative = new TreeMap<>();
    for (Sample s : samples) {
      if (s.name().equals(bucketName) && filter.test(s.labels()) && s.labels().containsKey("le")) {
        String le = s.labels().get("le");
        double bound = "+Inf".equals(le) ? Double.POSITIVE_INFINITY : Double.parseDouble(le);
        cumulative.merge(bound, s.value(), Double::sum);
      }
    }
    if (cumulative.isEmpty()) {
      return null;
    }
    double total = cumulative.lastEntry().getValue();
    if (total <= 0) {
      return null;
    }
    double rank = q * total;
    double lowerBound = 0;
    double lowerCount = 0;
    for (var e : cumulative.entrySet()) {
      if (e.getValue() >= rank) {
        if (e.getKey().isInfinite()) {
          return lowerBound; // acima do maior balde: o maior limite conhecido
        }
        double inBucket = e.getValue() - lowerCount;
        double fraction = inBucket <= 0 ? 1 : (rank - lowerCount) / inBucket;
        return lowerBound + (e.getKey() - lowerBound) * fraction;
      }
      lowerBound = e.getKey();
      lowerCount = e.getValue();
    }
    return lowerBound;
  }

  /** Métricas da página de saúde a partir do texto de um serviço. */
  ServiceMetrics toServiceMetrics() {
    Predicate<Map<String, String>> business =
        l -> !l.getOrDefault("uri", "").startsWith("/actuator");
    double requests = sum("http_server_requests_seconds_count", business);
    double errors =
        sum(
            "http_server_requests_seconds_count",
            business.and(l -> l.getOrDefault("status", "").startsWith("5")));
    Double p99 = quantile("http_server_requests_seconds_bucket", 0.99, business);
    String outbox = "plataforma_outbox_pendentes";
    String lag = "plataforma_outbox_atraso_seconds";
    String consumed = "plataforma_eventos_consumo_seconds_count";
    Predicate<Map<String, String>> ok =
        l -> List.of("processado", "duplicado").contains(l.getOrDefault("resultado", ""));
    Predicate<Map<String, String>> failed =
        l -> List.of("falha", "dead-letter").contains(l.getOrDefault("resultado", ""));
    double pending = sum(outbox, l -> true);
    return new ServiceMetrics(
        (long) requests,
        requests == 0 ? 0 : errors / requests,
        p99 == null ? null : p99 * 1000,
        has(outbox) && pending >= 0 ? (long) pending : null,
        has(lag) ? sum(lag, l -> true) : null,
        has(consumed) ? (long) sum(consumed, ok) : null,
        has(consumed) ? (long) sum(consumed, failed) : null);
  }
}
