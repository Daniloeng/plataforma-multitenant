package br.dev.plataforma.catalogo;

import java.time.Instant;
import java.util.List;

/** Representação pública de um produto (schema {@code Produto}). */
public record ProdutoView(
    String id,
    String sku,
    String nome,
    Dinheiro preco,
    boolean ativo,
    Instant criadoEm,
    Instant atualizadoEm) {

  static ProdutoView of(ProdutoDocument doc) {
    return new ProdutoView(
        doc.getId(),
        doc.getSku(),
        doc.getNome(),
        new Dinheiro(doc.getPrecoCentavos(), doc.getMoeda()),
        doc.isAtivo(),
        doc.getCriadoEm(),
        doc.getAtualizadoEm());
  }

  /**
   * Página da listagem.
   *
   * @param total produtos que atendem ao filtro, em todas as páginas
   * @param limitePlano máximo de produtos do plano do tenant
   * @param usados produtos do tenant, ativos e inativos
   */
  public record Pagina(
      List<ProdutoView> itens, String proximoCursor, long total, int limitePlano, long usados) {}
}
