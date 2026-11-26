# Argo CD (GitOps)

O Argo CD mantém o cluster de homologação igual ao que está na `main` (ADR-0016). Ele aplica
o chart `deploy/helm/plataforma` com `values-homolog.yaml`, e uma mudança só chega ao cluster por
merge na `main`.

```
deploy/argocd/
  projeto.yaml          AppProject "plataforma": só este repositório e os charts do KEDA
  raiz.yaml             app of apps: aplica tudo o que está em apps/
  apps/keda.yaml        KEDA (chart oficial), antes da plataforma (sync-wave -1)
  apps/plataforma.yaml  a plataforma, no namespace "plataforma"
```

## Instalar num cluster

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.14.11/manifests/install.yaml
kubectl apply -f deploy/argocd/projeto.yaml -f deploy/argocd/raiz.yaml
kubectl -n argocd get applications -w
```

As imagens vêm do `ghcr.io/daniloeng`, publicadas pelo workflow `release.yml` na versão do chart
(`appVersion`). Para publicar uma versão nova: suba o `appVersion`, faça o merge e rode o
workflow de release com a mesma versão.

O CI não instala o Argo CD: ele confere os manifests com `kubeconform` e instala o chart direto
com Helm no kind. Um Argo CD efêmero só sincronizaria a `main`, e não o código do PR.
