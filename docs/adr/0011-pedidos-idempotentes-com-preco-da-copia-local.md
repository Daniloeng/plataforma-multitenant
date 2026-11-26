# ADR-0011: Pedidos idempotentes com preço da cópia local do catálogo

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto
O pedido B2B é a primeira operação que move dinheiro. Três riscos aparecem juntos. Uma rede ruim
faz o comprador repetir o POST, e um pedido duplicado vira cobrança em dobro no Dia 7. O preço não
pode vir do cliente, que poderia mandar qualquer valor. E o pedidos-service não pode ler o MongoDB
do catálogo (ADR-0002) nem depender de ele estar no ar para vender.

## Decisão
- **Idempotency-Key obrigatória no POST /api/v1/pedidos**, com 8 a 64 caracteres ASCII visíveis
  (o frontend manda um UUID por tentativa de compra). A chave vale por cliente dentro do tenant:
  índice único `(tenantId, clienteId, idempotencyKey)`. O pedido guarda o SHA-256 dos itens
  (produto e quantidade, na ordem enviada).
  - Mesma chave e mesmo corpo: 200 com o pedido já criado e `Idempotent-Replayed: true`, sem
    novo evento.
  - Mesma chave e outro corpo: 409 `chave-reutilizada`.
  - Duas requisições simultâneas com a mesma chave: só uma cria. A outra bate no índice único
    (chave duplicada) ou, se a primeira ainda não fez commit, num conflito de escrita do MongoDB;
    nos dois casos recebe 409 `conflito`, e repetir devolve o pedido da primeira. A chave é por
    cliente, e não só por tenant como dizia o ADR-0006.
- **O preço vem da cópia local do catálogo.** O corpo só traz `produtoId` e `quantidade`; campos
  só de leitura enviados pelo cliente são ignorados. O `ProdutoLocal` junta `produto.alterado`
  (sku, nome, ativo) e `preco.alterado` (preço), cada metade com a própria `versao`, porque os dois
  tópicos compartilham o contador do catálogo e chegam em qualquer ordem (ADR-0010).
- **Produto sem as duas metades, inativo ou inexistente é indisponível:** 409
  `produto-indisponivel`, com os ids na propriedade `produtos` do Problem Details.
- **O pedido congela nome e preço do momento da compra.** Mudança de preço vale só para pedidos
  novos.
- **Os tópicos do catálogo têm retenção infinita**, como os de tenants (altera o ADR-0010): um
  pedidos-service novo (ou com o banco recriado) reconstrói a cópia local lendo desde o início.
- **O motivo do cancelamento registra quem cancelou:** `SOLICITADO_PELO_CLIENTE` (comprador) ou
  `CANCELADO_PELO_TENANT` (gestor ou admin), símbolo novo e compatível do enum.
- **Coleções que os consumidores gravam são criadas na subida**, fora de transação: criadas no
  primeiro evento, duas transações simultâneas abortariam uma à outra (achado do CI do Dia 5).

## Consequências
- Repetir um POST é seguro; o Dia 7 pode cobrar `pedido.criado` sem medo de duplicata.
- Entre o cadastro no catálogo e o evento chegar, o produto fica indisponível por alguns
  milissegundos. O CI e o frontend tratam isso como consistência eventual.
- Um preço alterado logo antes da compra pode ainda não ter chegado; o pedido usa o último preço
  conhecido e mostra o valor cobrado. O frontend avisa que o total do carrinho é estimado.
- O cliente precisa gerar e guardar a chave entre tentativas da mesma compra.
- Sem compactação, os tópicos do catálogo guardam todo o histórico de preços e um consumidor novo
  relê tudo. Compactar por chave (`tenantId:produtoId`) fica para o Dia 10, com a observabilidade
  mostrando o tamanho dos tópicos.
- Quando `produto.alterado` e `preco.alterado` de um produto novo chegam juntos, uma das duas
  transações aborta ao inserir a cópia e a nova tentativa, 1 s depois, resolve.

## Alternativas consideradas
- **Consultar o catálogo por HTTP na criação:** acopla a disponibilidade dos pedidos à do catálogo
  e soma a latência de outra chamada; a cópia local responde sem rede.
- **Aceitar o preço do cliente e validar depois:** abre espaço para fraude e para pedidos que
  precisam ser corrigidos depois de criados.
- **Idempotência por janela de tempo, sem chave:** não distingue uma repetição de um segundo
  pedido igual de verdade.
- **Guardar as chaves em coleção separada com TTL:** mais uma escrita por pedido; no pedido, a
  chave já fica junto do resultado que precisa ser devolvido.
