{{- define "dealbot.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dealbot.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "dealbot.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dealbot.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "dealbot.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "dealbot.postgres.fullname" -}}
{{- $base := include "dealbot.fullname" . -}}
{{- $suffix := "-postgres" -}}
{{- $maxBaseLength := sub 63 (len $suffix) -}}
{{- printf "%s%s" ($base | trunc $maxBaseLength | trimSuffix "-") $suffix | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dealbot.postgres.name" -}}
{{- $base := include "dealbot.name" . -}}
{{- $suffix := "-postgres" -}}
{{- $maxBaseLength := sub 63 (len $suffix) -}}
{{- printf "%s%s" ($base | trunc $maxBaseLength | trimSuffix "-") $suffix | trunc 63 | trimSuffix "-" -}}
{{- end -}}
