package br.dev.plataforma.status;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Monta as verificações a partir de {@link StatusProperties}. */
@Configuration(proxyBeanMethods = false)
public class StatusConfiguration {

  @Bean
  Clock clock() {
    return Clock.systemUTC();
  }

  @Bean
  List<ComponentCheck> componentChecks(StatusProperties props) {
    List<ComponentCheck> checks = new ArrayList<>();
    props.mongo().forEach(m -> checks.add(new MongoCheck(m.name(), m.uri(), props.timeout())));
    if (props.pulsar() != null) {
      checks.add(
          new PulsarCheck(props.pulsar().name(), props.pulsar().adminUrl(), props.timeout()));
    }
    return List.copyOf(checks);
  }

  @Bean
  StatusService statusService(
      List<ComponentCheck> componentChecks,
      Clock clock,
      @Value("${plataforma.status.version:dev}") String version) {
    return new StatusService(componentChecks, clock, version);
  }
}
