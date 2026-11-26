package br.dev.plataforma.spring;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import br.dev.plataforma.core.TenantId;
import br.dev.plataforma.spring.tenancy.MissingTenantException;
import br.dev.plataforma.spring.tenancy.TenantContext;
import br.dev.plataforma.spring.tenancy.TenantQueries;
import org.bson.Document;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Criteria;

class TenantContextTest {

  private static final TenantId ACME = new TenantId("acme");
  private static final TenantId GLOBEX = new TenantId("globex");

  @Test
  void semContextoNaoHaTenantERequireFalha() {
    assertThat(TenantContext.current()).isEmpty();
    assertThat(TenantContext.clienteId()).isEmpty();
    assertThatThrownBy(TenantContext::require)
        .isInstanceOf(MissingTenantException.class)
        .hasMessageContaining("X-Tenant-Id");
  }

  @Test
  void callAsDefineERestauraOContextoAnterior() throws Exception {
    String resultado =
        TenantContext.callAs(
            ACME,
            "cli-1",
            () -> {
              assertThat(TenantContext.require()).isEqualTo(ACME);
              assertThat(TenantContext.clienteId()).contains("cli-1");
              TenantContext.runAs(
                  GLOBEX, () -> assertThat(TenantContext.require()).isEqualTo(GLOBEX));
              assertThat(TenantContext.require()).isEqualTo(ACME);
              return "ok";
            });

    assertThat(resultado).isEqualTo("ok");
    assertThat(TenantContext.current()).isEmpty();
  }

  @Test
  void contextoELimpoMesmoComExcecao() {
    assertThatThrownBy(
            () ->
                TenantContext.runAs(
                    ACME,
                    () -> {
                      throw new IllegalArgumentException("falhou");
                    }))
        .hasMessage("falhou");
    assertThat(TenantContext.current()).isEmpty();
  }

  @Test
  void runAsEmbrulhaExcecaoChecada() {
    assertThatThrownBy(
            () ->
                TenantContext.runAs(
                    ACME,
                    () -> {
                      throw sneaky(new java.io.IOException("io"));
                    }))
        .isInstanceOf(IllegalStateException.class)
        .hasCauseInstanceOf(java.io.IOException.class);
  }

  @SuppressWarnings("unchecked")
  private static <E extends Throwable> RuntimeException sneaky(Throwable e) throws E {
    throw (E) e;
  }

  @Test
  void consultasSaoSempreFiltradasPeloTenant() {
    TenantContext.runAs(
        ACME,
        () -> {
          Document so = TenantQueries.scoped().getQueryObject();
          assertThat(so).isEqualTo(new Document("tenantId", "acme"));

          Document combinada =
              TenantQueries.scoped(Criteria.where("status").is("PENDENTE")).getQueryObject();
          assertThat(combinada.toJson()).contains("\"tenantId\": \"acme\"").contains("PENDENTE");
        });
  }

  @Test
  void consultaSemTenantFalha() {
    assertThatThrownBy(TenantQueries::scoped).isInstanceOf(MissingTenantException.class);
  }
}
