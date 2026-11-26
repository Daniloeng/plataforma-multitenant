# ADR-0016: Kubernetes com Helm, KEDA e Argo CD

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto
O MVP1 (Dia 11) precisa rodar a plataforma num Kubernetes, não só no Compose. Os requisitos do
projeto pedem Kubernetes, o custo ainda é zero e a homologação prevista no plano é um cluster kind
efêmero no GitHub Actions; uma VPS permanente fica para decidir depois do Dia 11. O lease do relay
(ADR-0015) já permite mais de uma réplica por serviço, e o consumo é Key_Shared (ADR-0010), então
escalar consumidores não quebra a ordem por agregado.

## Decisão
- **Um chart Helm só** (`deploy/helm/plataforma`) com a plataforma inteira: gateway, os quatro
  serviços, status-service, um MongoDB por serviço, Pulsar standalone e Keycloak. Nomes de
  Service e portas iguais aos do Compose, para a configuração dos serviços não mudar.
  - MongoDB como StatefulSet de um nó, replica set iniciado pela readinessProbe (mesmo script do
    healthcheck do Compose), com Service headless e `publishNotReadyAddresses` para o nó resolver o
    próprio nome antes de ficar pronto. Clientes usam `mongo-<db>-0.mongo-<db>`.
  - Ordem de subida por initContainers: cada serviço espera o MongoDB dele virar PRIMARY e o
    namespace Pulsar dele existir (criado por um Job com o mesmo `init.sh` do Compose). Sem hooks
    do Helm, que travariam o `helm install --wait` e não se traduzem bem no Argo CD.
  - Contêineres com o usuário 10001, sem privilégio, `readOnlyRootFilesystem` e `/tmp` em
    `emptyDir`; probes de startup, readiness e liveness do Actuator.
  - Cópias de `init.sh` e do realm do Keycloak ficam em `files/` (o Helm não lê fora do chart); o
    CI falha se divergirem das originais.
- **Fronteira de rede por NetworkPolicy.** No Compose, os serviços só eram alcançáveis pela rede
  interna; no Kubernetes, sem política, qualquer pod do cluster chamaria um serviço com
  `X-Tenant-Id` e `X-Papeis` forjados ou leria o MongoDB de outro serviço. O chart nega toda
  entrada no namespace e libera: o gateway (8000) para todos; a porta de gestão dele (8001, num
  Service à parte e sempre interno) só para o status-service; cada serviço só para o gateway e o
  status-service; cada MongoDB só para o serviço dono e o status-service; o Pulsar para os pods da
  plataforma e o namespace do KEDA. O CI confere com um pod intruso.
- **Segredos:** a senha do admin do Keycloak fica num Secret, gerada na instalação quando não
  informada (ou um `existingSecret`). O Keycloak segue em `start-dev`, com os usuários de
  demonstração: não pode ser exposto por Ingress enquanto for assim.
- **Gateway com uma réplica só:** o rate limit por plano é em memória e se multiplicaria.
- **KEDA** escala o pagamentos-service pelo backlog da assinatura `pagamentos-pedido-criado`
  no Pulsar (scaler nativo, 20 mensagens por réplica, de 1 a 3 réplicas). O pedidos-service roda
  com 2 réplicas fixas para exercitar o lease do relay. Quem escala pelo backlog usa fila pequena no
  consumidor (`plataforma.events.receiver-queue-size`, 20 no pagamentos-service; o padrão do
  Pulsar é 1000): em Key_Shared, o que já foi entregue a uma réplica não passa para as novas, e uma
  fila grande deixaria as réplicas novas ociosas num pico. Tópico e assinatura do `ScaledObject`
  são conferidos contra o `EventCatalog` por teste.
- **Argo CD** em GitOps, com app of apps (`deploy/argocd/raiz.yaml`): KEDA (chart oficial) e a
  plataforma, com `values-homolog.yaml`, sincronizados da `main`. O AppProject limita os
  repositórios de origem e os namespaces de destino.
- **Imagens versionadas** no `ghcr.io/daniloeng/plataforma-<serviço>:<versão>`, publicadas pelo
  workflow `release.yml`, que também cria a tag `v<versão>` e a release com o chart empacotado. A
  versão é o `appVersion` do chart; o workflow recusa versão diferente, commit fora da `main`,
  commit sem CI verde e imagem que já exista (tag de imagem imutável). Actions de workflows com
  segredo ou escrita ficam fixadas por SHA.
- **CI**: um job sobe um kind, carrega as imagens do build, instala o KEDA e o chart com
  `helm install --wait`, roda `helm test` e confere de ponta a ponta: status UP com
  `runtime.platform = kubernetes`, seed pelo gateway, um líder do relay entre as duas réplicas do
  pedidos-service e o KEDA subindo o pagamentos-service com backlog real (consumidor pausado,
  60 pedidos, despausa). Lint estrito e `kubeconform` validam o chart e os manifests do Argo CD.
- **`/api/status` ganha `runtime`** (opcional): `kubernetes`, `compose` ou `local`, com namespace
  e instância. A página de saúde mostra onde a plataforma está rodando. O nome do pod passa a ser
  público; é um dado de baixo risco e ajuda a ver qual réplica respondeu.

## Consequências
- `helm install` sobe a plataforma em qualquer cluster; o mesmo chart serve kind, homologação e,
  com outros values, uma VPS.
- O Argo CD não roda no CI: ele sincronizaria a `main`, não o código do PR. Os manifests são
  validados por schema, e a instalação real fica para quando houver um cluster permanente.
- Segredos ainda em texto (senha do admin do Keycloak em values, só estudo). Antes de qualquer
  ambiente exposto: Secret externo (Sealed Secrets ou External Secrets) e Keycloak em modo
  produção com banco próprio.
- Pulsar e MongoDB de um nó: sem alta disponibilidade. Suficiente para o estudo e para a fase de
  QA; operadores (MongoDB Community Operator, chart oficial do Pulsar) ficam como evolução.
- Prometheus, Grafana e Tempo ainda só no Compose; no cluster, os pods têm as anotações
  `prometheus.io/*` para um Prometheus que venha depois.
- Duas cópias de arquivos (init do Pulsar e realm) com conferência no CI.

## Alternativas consideradas
- **Um chart por serviço, com subcharts.** Mais próximo de times independentes, mas com sete
  charts para um projeto de estudo com um só time; o chart único mantém os valores num lugar.
- **Charts da comunidade para MongoDB e Pulsar (Bitnami, Apache).** Mais completos, mas pesados
  para um kind no CI (o chart oficial do Pulsar sobe ZooKeeper, BookKeeper e broker separados) e
  com imagens que mudaram de distribuição; o standalone repete o que o Compose já valida.
- **HPA por CPU em vez do KEDA.** O gargalo do consumidor é fila, não CPU; o backlog do Pulsar é o
  sinal certo, e o KEDA traz isso sem escrever um adaptador de métricas.
- **Flux em vez do Argo CD.** Equivalente para GitOps; o Argo CD tem interface para acompanhar a
  sincronização, útil para estudo e para a fase de QA.
