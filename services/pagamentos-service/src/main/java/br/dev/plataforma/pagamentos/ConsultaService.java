package br.dev.plataforma.pagamentos;

import br.dev.plataforma.spring.tenancy.TenantContext;
import br.dev.plataforma.spring.tenancy.TenantQueries;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import org.bson.Document;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.aggregation.Aggregation;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

/** Leituras de pagamentos e do ledger, sempre filtradas pelo tenant do contexto. */
@Service
public class ConsultaService {

  static final int MAX_PAGE = 100;
  static final String MOEDA_PADRAO = "BRL";

  private final MongoOperations mongo;

  public ConsultaService(MongoOperations mongo) {
    this.mongo = mongo;
  }

  public Views.PaginaPagamentos listar(
      String pedidoId, StatusPagamento status, String cursor, int limite) {
    validarLimite(limite);
    // Marca de cancelamento sem cobrança não é pagamento: fica de fora.
    List<Criteria> filtros = new ArrayList<>(List.of(Criteria.where("status").ne(null)));
    if (pedidoId != null) {
      filtros.add(Criteria.where("pedidoId").is(pedidoId));
    }
    if (status != null) {
      filtros.add(Criteria.where("status").is(status));
    }
    Pagina<PagamentoDocument> p =
        pagina(
            filtros,
            "criadoEm",
            cursor,
            limite,
            PagamentoDocument.class,
            PagamentoDocument::getCriadoEm,
            PagamentoDocument::getId);
    return new Views.PaginaPagamentos(
        p.itens().stream().map(Views.PagamentoView::of).toList(), p.proximo());
  }

  public Views.PagamentoView obter(String id) {
    PagamentoDocument doc =
        mongo.findOne(
            TenantQueries.scoped(Criteria.where("_id").is(id).and("status").ne(null)),
            PagamentoDocument.class);
    if (doc == null) {
      throw new NaoEncontrado(id);
    }
    return Views.PagamentoView.of(doc);
  }

  public Views.Extrato extrato(String cursor, int limite) {
    validarLimite(limite);
    Pagina<Lancamento> p =
        pagina(
            new ArrayList<>(),
            "ocorridoEm",
            cursor,
            limite,
            Lancamento.class,
            Lancamento::getOcorridoEm,
            Lancamento::getId);
    return new Views.Extrato(
        p.itens().stream().map(Views.LancamentoView::of).toList(), saldo(), p.proximo());
  }

  /** Receita líquida: créditos em RECEITA_TENANT menos débitos em ESTORNOS, somados no banco. */
  Dinheiro saldo() {
    String tenant = TenantContext.require().toString();
    Criteria receita =
        Criteria.where("conta")
            .is(Lancamento.Conta.RECEITA_TENANT)
            .and("natureza")
            .is(Lancamento.Natureza.CREDITO);
    Criteria estornos =
        Criteria.where("conta")
            .is(Lancamento.Conta.ESTORNOS)
            .and("natureza")
            .is(Lancamento.Natureza.DEBITO);
    Aggregation agg =
        Aggregation.newAggregation(
            Aggregation.match(Criteria.where("tenantId").is(tenant).orOperator(receita, estornos)),
            Aggregation.group("conta", "moeda").sum("valorCentavos").as("total"));
    long saldo = 0;
    String moeda = MOEDA_PADRAO;
    for (Document d : mongo.aggregate(agg, Lancamento.class, Document.class).getMappedResults()) {
      Document id = d.get("_id", Document.class);
      long total = ((Number) d.get("total")).longValue();
      moeda = id.getString("moeda");
      saldo +=
          Lancamento.Conta.RECEITA_TENANT.name().equals(id.getString("conta")) ? total : -total;
    }
    return new Dinheiro(saldo, moeda);
  }

  private record Pagina<T>(List<T> itens, String proximo) {}

  private <T> Pagina<T> pagina(
      List<Criteria> filtros,
      String campo,
      String cursor,
      int limite,
      Class<T> tipo,
      Function<T, java.time.Instant> quando,
      Function<T, String> id) {
    if (cursor != null && !cursor.isBlank()) {
      filtros.add(Cursor.decodificar(cursor).depois(campo));
    }
    Query query =
        TenantQueries.scoped(
                filtros.isEmpty() ? new Criteria() : new Criteria().andOperator(filtros))
            .with(Sort.by(Sort.Order.desc(campo), Sort.Order.desc("_id")))
            .limit(limite + 1);
    List<T> docs = mongo.find(query, tipo);
    boolean temMais = docs.size() > limite;
    List<T> itens = docs.stream().limit(limite).toList();
    String proximo = null;
    if (temMais) {
      T ultimo = itens.getLast();
      proximo = new Cursor(quando.apply(ultimo), id.apply(ultimo)).codificar();
    }
    return new Pagina<>(itens, proximo);
  }

  private static void validarLimite(int limite) {
    if (limite < 1 || limite > MAX_PAGE) {
      throw new RequisicaoInvalida("limite deve ficar entre 1 e " + MAX_PAGE + ".");
    }
  }
}
