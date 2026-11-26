# Argo CD (GitOps)

O Argo CD mantém o cluster de homologação igual ao que está na `main` (ADR-0016). Ele aplica
o chart `deploy/helm/plataforma` com `values-homolog.yaml`, e uma mudança só chega ao cluster por
merge na `main`.

```
deploy/argocd/
  projeto.yaml          AppProjects: "plataforma" (este repositório e o chart do KEDA, namespaces
                        plataforma e keda) e "raiz" (só cria Applications no argocd)
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
(`appVersion`). Pacotes novos no ghcr.io nascem privados: torne-os públicos uma vez (Package
settings), senão o cluster fica em `ImagePullBackOff`.

O Argo CD segue a `main`. Entre o merge que sobe o `appVersion` e o fim do release, a imagem nova
ainda não existe e os pods novos esperam por ela (os antigos continuam de pé). Por isso, rode o
release logo depois do merge; ele só publica commit da `main` com o CI verde.

O `ScaledObject` tem `SkipDryRunOnMissingResource`: na primeira sincronização o CRD do KEDA pode
ainda não existir (a onda -1 não espera a saúde de uma Application).

O CI não instala o Argo CD: ele confere os manifests com `kubeconform` e instala o chart direto
com Helm no kind. Um Argo CD efêmero só sincronizaria a `main`, e não o código do PR.
