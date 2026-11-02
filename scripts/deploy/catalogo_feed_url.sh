#!/usr/bin/env bash
# Gera um NOVO token do feed do catálogo, grava CATALOGO_FEED_TOKEN nas Edge Functions e COPIA a URL do feed para a área de
# transferência (pbcopy) SEM imprimi-la. Use quando precisar cadastrar o feed num catálogo da Meta (Fontes de dados → Feed → URL).
# ATENÇÃO: trocar o token invalida a URL antiga; catálogos que ainda usam a URL velha passam a falhar até receberem a nova.
# Rode:  bash scripts/deploy/catalogo_feed_url.sh   e cole (cmd+V) na Meta.
set -euo pipefail
REF=yqimfktanresuboqfdti
command -v pbcopy >/dev/null || { echo "pbcopy não encontrado (macOS)"; exit 1; }
TOKEN=$(openssl rand -hex 24)
umask 077
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
echo "CATALOGO_FEED_TOKEN=$TOKEN" > "$TMP"
supabase secrets set --env-file "$TMP" --project-ref "$REF" >/dev/null
printf '%s' "https://$REF.supabase.co/functions/v1/catalogo-meta-feed?t=$TOKEN" | pbcopy
echo "OK: novo token gravado e a URL do feed está na área de transferência (cole na Meta com cmd+V)."
