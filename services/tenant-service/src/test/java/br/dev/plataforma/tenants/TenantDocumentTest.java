package br.dev.plataforma.tenants;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class TenantDocumentTest {

  static final Instant CRIADO = Instant.parse("2026-11-26T10:00:00Z");
  static final Instant AGORA = Instant.parse("2026-11-26T11:00:00Z");

  final TenantDocument acme =
      new TenantDocument(
          "acme", "ACME", Plano.GRATUITO, NivelIsolamento.POOL, true, CRIADO, CRIADO, 3L);

  @Test
  void alteracaoParcialPreservaOsDemaisCampos() {
    TenantDocument novo =
        acme.withChanges(new TenantChange(null, Plano.EMPRESARIAL, null, null), AGORA);

    assertThat(novo.plano()).isEqualTo(Plano.EMPRESARIAL);
    assertThat(novo.nome()).isEqualTo("ACME");
    assertThat(novo.nivelIsolamento()).isEqualTo(NivelIsolamento.POOL);
    assertThat(novo.ativo()).isTrue();
    assertThat(novo.criadoEm()).isEqualTo(CRIADO);
    assertThat(novo.atualizadoEm()).isEqualTo(AGORA);
    assertThat(novo.version()).isEqualTo(3L);
  }

  @Test
  void alteracaoCompleta() {
    TenantDocument novo =
        acme.withChanges(
            new TenantChange("Nova", Plano.PROFISSIONAL, NivelIsolamento.SILO, false), AGORA);

    assertThat(novo)
        .extracting(
            TenantDocument::nome,
            TenantDocument::plano,
            TenantDocument::nivelIsolamento,
            TenantDocument::ativo)
        .containsExactly("Nova", Plano.PROFISSIONAL, NivelIsolamento.SILO, false);
  }

  @Test
  void mesmoEstadoIgnoraDatasEVersao() {
    TenantDocument tocado = acme.withChanges(new TenantChange("ACME", null, null, true), AGORA);
    assertThat(tocado.sameStateAs(acme)).isTrue();
    assertThat(
            acme.withChanges(new TenantChange("Outra", null, null, null), AGORA).sameStateAs(acme))
        .isFalse();
    assertThat(
            acme.withChanges(new TenantChange(null, Plano.PROFISSIONAL, null, null), AGORA)
                .sameStateAs(acme))
        .isFalse();
    assertThat(
            acme.withChanges(new TenantChange(null, null, NivelIsolamento.SILO, null), AGORA)
                .sameStateAs(acme))
        .isFalse();
    assertThat(acme.withChanges(new TenantChange(null, null, null, false), AGORA).sameStateAs(acme))
        .isFalse();
  }

  @Test
  void alteracaoVazia() {
    assertThat(new TenantChange(null, null, null, null).isEmpty()).isTrue();
    assertThat(new TenantChange(null, null, null, false).isEmpty()).isFalse();
  }

  @Test
  void cursorEOpacoEReversivel() {
    String cursor = TenantService.encodeCursor("acme-ltda");
    assertThat(cursor).doesNotContain("acme");
    assertThat(TenantService.decodeCursor(cursor)).isEqualTo("acme-ltda");
    assertThatThrownBy(() -> TenantService.decodeCursor("%%"))
        .isInstanceOf(TenantExceptions.InvalidRequest.class);
  }
}
