package br.dev.plataforma.gateway;

import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Uma rota por serviço; cada novo serviço de negócio ganha a sua aqui (Dias 5 a 7). */
@Configuration
public class Routes {

  @Bean
  RouteLocator platformRoutes(RouteLocatorBuilder routes, GatewayProperties props) {
    return routes
        .routes()
        .route("status", r -> r.path("/api/status").uri(props.services().status()))
        .route(
            "tenants",
            r -> r.path("/api/v1/tenants", "/api/v1/tenants/**").uri(props.services().tenants()))
        .route(
            "catalogo",
            r -> r.path("/api/v1/produtos", "/api/v1/produtos/**").uri(props.services().catalogo()))
        .build();
  }
}
