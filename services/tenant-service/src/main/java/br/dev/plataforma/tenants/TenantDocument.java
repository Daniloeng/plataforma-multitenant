package br.dev.plataforma.tenants;

import br.dev.plataforma.contracts.tenants.NivelIsolamento;
import br.dev.plataforma.contracts.tenants.Plano;
import java.time.Instant;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * Tenant gravado no MongoDB do serviço. O {@code _id} é o próprio TenantId (slug), que já é único e
 * dá a ordem estável usada na paginação por cursor.
 *
 * @param version controle de concorrência otimista: duas alterações simultâneas não se sobrepõem
 */
@Document("tenants")
public record TenantDocument(
    @Id String id,
    String nome,
    Plano plano,
    NivelIsolamento nivelIsolamento,
    boolean ativo,
    Instant criadoEm,
    Instant atualizadoEm,
    @Version Long version) {

  TenantDocument withChanges(TenantChange change, Instant now) {
    return new TenantDocument(
        id,
        change.nome() == null ? nome : change.nome(),
        change.plano() == null ? plano : change.plano(),
        change.nivelIsolamento() == null ? nivelIsolamento : change.nivelIsolamento(),
        change.ativo() == null ? ativo : change.ativo(),
        criadoEm,
        now,
        version);
  }
}
