# ADR-0014: Promoção de nível com database por tenant e migração online

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto
O ADR-0005 definiu três níveis de isolamento (Pool, Bridge e Silo), mas até o Dia 8 todo tenant
morava no Pool: coleções compartilhadas filtradas por `tenantId`. Um cliente que cresce precisa
subir de nível sem perder dados e sem parar os outros tenants. Os dados mudam enquanto o tenant
usa o sistema (pedidos chegando, eventos de pagamento), e o pedidos-service roda com várias
réplicas. O custo continua zero: nada de instância MongoDB nova por tenant até haver orçamento.

## Decisão
- **Promoção explícita e só para cima.** `POST /api/v1/tenants/{id}/promocao` (só
  plataforma-admin) sobe o nível (POOL → BRIDGE → SILO, pode pular) e publica `tenant.alterado`
  pelo outbox. Repetir ou rebaixar dá 409 `nivel-invalido`; o PATCH segue recusando troca de nível.
- **Database por tenant no serviço que guarda dados.** BRIDGE e SILO ficam em
  `<database padrão>_t_<tenant>` (no pedidos-service, `pedidos_t_acme`). A biblioteca comum traz a
  `TenantRoutingMongoDatabaseFactory`, que escolhe a database pelo tenant do contexto; o
  `MongoTemplate`, os repositórios e as transações a usam sem saber. Liga com
  `plataforma.isolation.enabled` e a lista das coleções de negócio que migram.
- **Coleções da plataforma ficam na database padrão.** Outbox, deduplicação de eventos e o mapa de
  níveis (`tenant_niveis`) não migram (`PlatformDatabase`). Uma transação grava o pedido na
  database do tenant e o outbox na padrão: o MongoDB aceita transações entre databases do mesmo
  replica set, e o relay continua lendo um lugar só.
- **Mapa de níveis em memória, persistido e relido.** Cada serviço consome `tenant.criado` e
  `tenant.alterado` (maior versão vence) e grava a posição do tenant em `tenant_niveis`, fora da
  transação do evento, sempre por compare-and-set (versão lida ou dono da migração): duas réplicas
  não se sobrescrevem. Toda réplica relê o mapa a cada 1 s e o carrega antes de o servidor web
  subir. **Falha fechada:** uma réplica que passa de `grace - refresh` (2 s) sem reler recusa as
  operações dos tenants com 503, porque pode não ter visto uma migração começar.
- **Migração online com carência.** Ao subir de nível, o tenant fica `MIGRANDO`: o roteamento
  recusa as operações dele (APIs respondem 503 `tenant-em-migracao` com `Retry-After: 1`).
  Depois de 3 s de carência (as outras réplicas relêem o mapa e param de gravar), o job:
  1. garante coleções e índices na database nova;
  2. copia os documentos do tenant em lotes (substituindo pelo `_id`) e **apaga da origem só o
     documento que continua igual ao copiado**; repete até a origem ficar vazia (no máximo 5
     passadas), então uma gravação atrasada nunca é apagada sem cópia;
  3. marca `PRONTO` (só a réplica dona do lease consegue);
  4. depois de mais uma carência, varre a origem: o que uma réplica atrasada gravou lá é movido se
     não existir na nova; se existir, fica na origem com erro no log.
- **Lease com dono e batimento.** A réplica dona renova o lease a cada lote; sem batimento por
  1 min, outra réplica assume, e a antiga, ao perceber, para sem apagar nem marcar nada. No
  desligamento o lease é solto na hora. Cada migração roda na sua thread virtual: promover dois
  tenants não deixa um esperando o outro. Falhas contam em `attempts`; a partir de 3 o log acusa
  erro a cada rodada (alerta de verdade com métricas no Dia 10).
- **Consumo sem travar vizinhos.** O `EventSubscriber` executa cada mensagem na fila serial do
  tenant dela (thread virtual, ordem por chave preservada). Durante a migração, o consumidor de
  negócio espera o tenant ficar pronto (até 2 min) antes do efeito, sem gastar tentativas do dead
  letter; os outros tenants seguem.
- **Índices evoluem nas databases dedicadas.** Na subida, o serviço recria nas dedicadas as
  coleções e os índices da padrão (criar o que existe não faz nada).
- **Jobs e tempo real passam por todas as databases.** A expiração de pedidos e o change stream da
  linha do tempo (ADR-0013) cobrem a padrão e cada dedicada.
- **Namespace Pulsar próprio.** O tenant-service cria `plataforma/t-<id>` para BRIDGE e SILO, com
  retenção e cota de backlog pelo plano, logo depois da promoção e por um reconciliador a cada
  30 s. Os tópicos de negócio continuam compartilhados por enquanto.
- `GET /api/v1/isolamento/pedidos` (gestor e admin) mostra nível, database e situação.

## Consequências
- Promover leva segundos de indisponibilidade só para o tenant promovido; os vizinhos não sentem.
- O pedidos-service é o primeiro a usar a database por tenant. Catálogo e pagamentos seguem no
  Pool para todos (dívida registrada): ligar neles é configuração, mas exige o mesmo teste de
  migração.
- **SILO é tratado como BRIDGE nos dados.** Instância MongoDB e namespace Kubernetes próprios
  ficam para quando houver Kubernetes e orçamento (Dia 11 em diante).
- A carência ainda depende do relógio: uma transação aberta antes da marcação e mais longa que a
  carência pode gravar na database antiga. A cópia em passadas e a varredura final impedem a
  perda silenciosa (o documento é movido ou acusado), mas um fence de escrita por época do tenant
  é o passo seguinte se virar problema.
- Um change stream por database na linha do tempo: uma conexão por tenant dedicado. Na escala de
  dezenas de tenants serve; com centenas, um único `watch` no cluster filtrando o nome da coleção.
- Rebaixar não move dados: se um dia for preciso, é outro job.
- O namespace dedicado ainda não recebe tópicos; ele já existe para as cotas e para a migração dos
  tópicos por tenant num dia futuro.

## Alternativas consideradas
- **Coleção por tenant na mesma database:** isola pouco (mesmo usuário, mesmos limites) e
  multiplica coleções; a database dá backup, cota e permissão por tenant.
- **Parar o serviço para migrar:** simples, mas derruba todos os tenants por causa de um.
- **Change data capture para a migração (copiar e seguir o oplog):** zero indisponibilidade, mas
  muito mais complexo do que os segundos de 503 valem num projeto de estudo.
- **Rotear pelo gateway (uma instância do serviço por nível):** isola processo, mas obriga a
  operar várias implantações já no Compose; fica para o Silo com Kubernetes.
