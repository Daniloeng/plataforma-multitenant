package br.dev.plataforma.pagamentos;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import org.springframework.data.mongodb.core.query.Criteria;

/** Posição numa listagem do mais recente ao mais antigo: data e id do último item, em base64url. */
record Cursor(Instant quando, String id) {

  String codificar() {
    String texto = quando.toEpochMilli() + "|" + id;
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(texto.getBytes(StandardCharsets.UTF_8));
  }

  /** Itens depois deste cursor na ordem (campo desc, _id desc). */
  Criteria depois(String campo) {
    return new Criteria()
        .orOperator(
            Criteria.where(campo).lt(quando), Criteria.where(campo).is(quando).and("_id").lt(id));
  }

  static Cursor decodificar(String cursor) {
    try {
      String texto = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      int sep = texto.indexOf('|');
      return new Cursor(
          Instant.ofEpochMilli(Long.parseLong(texto.substring(0, sep))), texto.substring(sep + 1));
    } catch (IllegalArgumentException | IndexOutOfBoundsException e) {
      throw new RequisicaoInvalida("cursor inválido.");
    }
  }
}
