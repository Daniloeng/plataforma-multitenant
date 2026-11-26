{{/* Rótulos comuns a todos os objetos. */}}
{{- define "plataforma.labels" -}}
app.kubernetes.io/part-of: plataforma
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}

{{/* Imagem de um serviço da plataforma: <registry>/<prefix><nome>:<tag>. */}}
{{- define "plataforma.image" -}}
{{- $root := index . 0 -}}
{{- $name := index . 1 -}}
{{- printf "%s/%s%s:%s" $root.Values.image.registry $root.Values.image.prefix $name (default $root.Chart.AppVersion $root.Values.image.tag) -}}
{{- end }}

{{/* Host do nó único do replica set de uma database (headless service do StatefulSet). */}}
{{- define "plataforma.mongoHost" -}}
{{- $root := index . 0 -}}
{{- $db := index . 1 -}}
{{- printf "mongo-%s-0.mongo-%s.%s.svc.cluster.local:27017" $db $db $root.Release.Namespace -}}
{{- end }}

{{/* Espera o MongoDB do serviço virar PRIMARY e o namespace dele existir no Pulsar. */}}
{{- define "plataforma.waitFor" -}}
{{- $root := index . 0 -}}
{{- $db := index . 1 -}}
{{- $namespace := index . 2 -}}
{{- if $db }}
- name: aguarda-mongo
  image: {{ $root.Values.mongo.image }}
  command:
    - bash
    - -c
    - >-
      until mongosh --quiet --host {{ include "plataforma.mongoHost" (list $root $db) }}
      --eval 'db.hello().isWritablePrimary || quit(1)'; do echo "aguardando mongo-{{ $db }}"; sleep 3; done
  resources:
    requests: { cpu: 10m, memory: 64Mi }
    limits: { memory: 256Mi }
{{- end }}
{{- if $namespace }}
- name: aguarda-pulsar
  image: {{ $root.Values.pulsar.initImage }}
  command:
    - sh
    - -c
    - >-
      until curl -fsS http://pulsar:8080/admin/v2/namespaces/plataforma/pagamentos/schemaCompatibilityStrategy | grep -q FULL;
      do echo "aguardando os namespaces do Pulsar"; sleep 3; done
  resources:
    requests: { cpu: 10m, memory: 16Mi }
    limits: { memory: 64Mi }
{{- end }}
{{- end }}

{{/* Segurança do contêiner: o usuário 10001 dos Dockerfiles, sem escalar privilégio. */}}
{{- define "plataforma.containerSecurity" -}}
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: [ALL] }
{{- end }}

{{/* Segurança do pod: perfil seccomp padrão do runtime (exigido pelo Pod Security "restricted"). */}}
{{- define "plataforma.podSecurity" -}}
securityContext:
  seccompProfile: { type: RuntimeDefault }
{{- end }}

{{/* /tmp gravável para a JVM (raiz somente leitura). */}}
{{- define "plataforma.tmpVolume" -}}
- name: tmp
  emptyDir: { sizeLimit: 256Mi }
{{- end }}

{{/* Probes do Actuator (ADR-0015): readiness tira do Service, liveness reinicia. */}}
{{- define "plataforma.probes" -}}
{{- $port := . -}}
startupProbe:
  httpGet: { path: /actuator/health/liveness, port: {{ $port }} }
  periodSeconds: 5
  failureThreshold: 60
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: {{ $port }} }
  periodSeconds: 5
  failureThreshold: 3
livenessProbe:
  httpGet: { path: /actuator/health/liveness, port: {{ $port }} }
  periodSeconds: 10
  failureThreshold: 6
{{- end }}

{{/* Variáveis comuns aos serviços Java. */}}
{{- define "plataforma.commonEnv" -}}
- name: PULSAR_URL
  value: pulsar://pulsar:6650
- name: PULSAR_ADMIN_URL
  value: http://pulsar:8080
- name: TRACING_EXPORT
  value: {{ .Values.tracing.export | quote }}
- name: OTLP_TRACING_ENDPOINT
  value: {{ .Values.tracing.endpoint | quote }}
{{- end }}
