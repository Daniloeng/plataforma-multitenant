# ADR-0010: Consumidor padrão de eventos e cópias locais de dados de outro serviço

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto

O catálogo é o primeiro serviço que consome eventos de outro: precisa do plano de cada tenant para
limitar o número de produtos, e o banco por serviço (ADR-0002) proíbe ler o MongoDB do
tenant-service. Pedidos e Pagamentos vão consumir eventos nos Dias 6 e 7. Sem um padrão, cada
serviço reinventaria assinatura, decodificação, deduplicação e tratamento de erro, e o ADR-0008
deixou como dívida o "consumidor padrão com cache de schemas".

## Decisão

- **`EventSubscriber` na biblioteca comum.** O serviço registra `on(TipoDoEvento, nome, efeito)`.
  A biblioteca:
  - assina o tópico do `EventCatalog` com assinatura **durável** `<plataforma.service>-<nome>`,
    tipo **Key_Shared** (a chave `tenantId:aggregateId` mantém a ordem por agregado mesmo com
    várias réplicas) e posição inicial **Earliest** (um serviço novo recebe o histórico retido);
  - decodifica com o **schema do escritor** (`EventDecoder`, versão buscada no Schema Registry e
    guardada em cache);
  - roda o efeito numa **transação MongoDB**, com o tenant do evento no `TenantContext`, através do
    `IdempotentConsumer` (reentrega não repete o efeito);
  - dá **ack depois do commit**; em erro, **nack** com nova tentativa em 1 s e, depois de
    `plataforma.events.max-redeliveries` (padrão 10), manda para o **dead letter**
    `persistent://plataforma/<serviço>/dlq.<assinatura>`, no namespace do consumidor.
- **A ordem por agregado vale enquanto nada falha.** Uma mensagem com nack volta depois de 1 s, e
  as seguintes da mesma chave já podem ter sido processadas. Por isso **todo evento de estado
  carrega `versao`** (o `@Version` do documento) e o consumidor ignora versão menor ou igual à
  que já tem **no mesmo tópico** (cada evento traz só parte do estado, e eventos de tópicos
  diferentes podem compartilhar o contador). `produto.alterado` e `preco.alterado` ganharam o
  campo (default 0, compatível).
- **Tópicos `tenant.*` com retenção infinita.** Um consumidor novo, ou com o banco recriado,
  reconstrói a cópia local lendo desde o início; os outros namespaces seguem com 3 dias. O dead
  letter nasce com a assinatura `<assinatura>-reprocessar`, que retém as mensagens até alguém
  tratá-las. Num ambiente local criado antes do Dia 5, recrie o volume do Pulsar
  (`docker compose down -v`) para o catálogo receber os tenants antigos.
- **Cópia local mínima.** O consumidor guarda só o que usa (o catálogo guarda plano, situação e
  `versao` de cada tenant) e aplica a regra de versão do ADR-0008: versão menor ou igual é
  ignorada.
- **Antes do primeiro evento, vale o mais restritivo.** Se o catálogo ainda não conhece o tenant,
  usa o limite do plano GRATUITO: um atraso de milissegundos nunca dá mais do que o contratado.
  Tenant suspenso na cópia local não altera o catálogo (403 `tenant-suspenso`), mesmo que o
  gateway ainda não saiba da suspensão.
- **Identidade nos serviços:** o `Caller` da biblioteca lê `X-Usuario`, `X-Papeis` e
  `X-Cliente-Id` escritos pelo gateway (ADR-0009) e vira parâmetro dos controllers.

## Consequências

- Um consumidor novo custa uma linha de registro e o efeito; os testes da biblioteca cobrem
  assinatura, reentrega, idempotência e contexto de tenant.
- Mudar o `nome` de um registro cria outra assinatura e reprocessa o tópico desde o início (a
  idempotência protege só o mesmo nome).
- Um evento de tenant que vá para o dead letter deixa a cópia local desatualizada até o próximo
  evento daquele tenant; reprocessar o dead letter é manual por enquanto.
- Mensagens no dead letter precisam de alguém que olhe: o painel de observabilidade do Dia 10
  ganha esse indicador.
- O limite de produtos é verificado por contagem antes da inserção: dois cadastros simultâneos no
  último lugar podem passar do limite por um. Aceitável para um limite comercial.

## Alternativas consideradas

- **`@PulsarListener` do Spring for Apache Pulsar:** resolve a assinatura, mas não a transação, a
  idempotência e o schema do escritor com Avro sombreado; teríamos que embrulhar do mesmo jeito.
- **Consultar o tenant-service por HTTP a cada cadastro:** acopla a disponibilidade do catálogo à
  do tenant-service e adiciona latência na escrita.
- **Assinatura Shared:** mais simples, mas perde a ordem por agregado com mais de uma réplica.
