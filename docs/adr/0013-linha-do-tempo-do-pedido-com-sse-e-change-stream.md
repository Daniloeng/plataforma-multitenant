# ADR-0013: Linha do tempo do pedido com SSE alimentado por change stream

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto
Com a saga completa (Dia 7), o pedido muda sozinho depois do POST: é confirmado, recusado,
cancelado por expiração ou estornado, por eventos que chegam de outro serviço. O comprador e o
gestor querem ver essas mudanças sem recarregar a página, e o histórico precisa explicar a saga
("pago, cancelado pelo cliente, valor estornado"). O pedidos-service pode rodar com várias réplicas,
e a mudança pode acontecer numa réplica diferente da que segura a conexão do navegador.

## Decisão
- **Histórico no próprio pedido.** `PedidoDocument.historico` guarda os marcos da saga (`CRIADO`,
  `PAGO`, `RECUSADO`, `CANCELADO`, `ESTORNADO`), cada um com data e detalhe, gravados na mesma
  escrita que muda o status. O pedido de antes do Dia 8 recebe um histórico derivado do status.
- **Pedidos consome `pagamento.estornado`** e anota o `ESTORNADO` uma vez só (o evento pode chegar de
  novo), sem mudar o status nem publicar evento.
- **Server-Sent Events** em `GET /api/v1/pedidos/{id}/linha-do-tempo`: o primeiro evento `pedido` traz
  o estado atual, e cada mudança traz o pedido inteiro, com `id:` igual à versão. Mesmas regras de
  acesso do GET. Comentário `: ping` a cada 15 s e fim da conexão em 5 min; o cliente reconecta e
  recebe o estado atual, então nenhuma mudança se perde.
- **Um change stream por réplica.** Cada réplica abre um change stream na coleção `pedidos`
  (`fullDocument: updateLookup`) e repassa a mudança às conexões abertas nela para aquele pedido. A
  mudança feita por outra réplica, pelo consumidor de eventos ou pelo job de expiração chega igual,
  porque vem do banco.
- **Releitura no batimento e change stream que se reabre.** A cada `ping` o pedido é relido e
  enviado se a versão avançou. Se o change stream cair (eleição ou restart do MongoDB), o batimento
  o reabre, e nesse meio tempo a tela atualiza com atraso de no máximo 15 s. O estado aparece no
  health (`linhaDoTempo.changeStream`).
- **Registrar antes de ler.** A conexão entra na lista antes da leitura do estado inicial: uma
  mudança entre as duas não se perde (a versão descarta a duplicata).
- **Envio que não bloqueia.** Cada conexão guarda só o pedido mais novo e o escreve numa thread
  virtual própria; um cliente lento ou sumido atrasa só a si mesmo, e uma falha de escrita tira a
  conexão da lista na hora.
- **Teto de conexões.** No máximo 50 por tenant e 500 por réplica (configuráveis); acima disso,
  429 `muitas-conexoes`. Réplica subindo ou desligando responde 503; no desligamento, as conexões
  abertas são encerradas e o navegador reconecta.
- **Mesma visão por papel.** O comprador recebe o marco RECUSADO sem o motivo exato do gateway,
  que é do tenant (decisão do Dia 7), no GET, na listagem e no SSE.
- **No navegador, `fetch` com leitura do corpo em stream**, não `EventSource`, que não envia o
  cabeçalho `Authorization`. O gateway repassa o fluxo sem mudança.

## Consequências
- O comprador vê "Pagamento aprovado" e "Valor estornado" aparecerem sozinhos, e o histórico fica
  disponível no GET e na listagem.
- Cada conexão SSE ocupa um request assíncrono do Tomcat (as threads virtuais já estão ligadas); a
  escala é de dezenas de conexões, não milhares.
- Um change stream por réplica é barato, mas exige replica set (já usado pelas transações).
- Mudanças de outros tenants também passam pelo change stream da réplica; o repasse filtra por
  `tenantId:pedidoId`, então nada vaza, mas o filtro é em memória.
- O gateway conta a conexão SSE como uma requisição no rate limit; o teto por tenant protege os
  vizinhos.
- O acesso é conferido ao abrir a conexão e não é reavaliado durante ela: um tenant suspenso ou um
  papel removido continua recebendo mudanças até a conexão fechar (no máximo 5 min).

## Alternativas consideradas
- **Poll do frontend:** simples, mas com atraso fixo e uma requisição por segundo por tela aberta.
- **WebSocket:** bidirecional sem necessidade; mais complexo no gateway e no navegador.
- **Notificar só a réplica local (após o commit):** perde as mudanças feitas por outra réplica ou
  pelo consumidor de eventos em outra instância.
- **Consumir os eventos do Pulsar para alimentar o SSE:** cada réplica precisaria de uma assinatura
  própria não durável e o estado ainda teria de ser lido do banco; o change stream já traz o
  documento.
