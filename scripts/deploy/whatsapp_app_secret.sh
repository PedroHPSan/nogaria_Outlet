#!/usr/bin/env bash
# Grava WHATSAPP_APP_SECRET (segredo do app Meta "Nogaria Outlet") nas Edge Functions SEM exibir nem deixar em histórico.
# Preciso dele para (1) validar a assinatura dos webhooks do WhatsApp e (2) trocar o código do Cadastro Incorporado.
# Onde achar: developers.facebook.com → app Nogaria Outlet → Configurações do app → Básico → "Chave secreta do aplicativo" (Mostrar).
# Rode:  bash scripts/deploy/whatsapp_app_secret.sh   (cole o segredo; a digitação não aparece)
set -euo pipefail
REF=yqimfktanresuboqfdti
read -r -s -p "Chave secreta do app Meta: " SEGREDO; echo
[ -n "$SEGREDO" ] || { echo "vazio"; exit 1; }
umask 077
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
echo "WHATSAPP_APP_SECRET=$SEGREDO" > "$TMP"
supabase secrets set --env-file "$TMP" --project-ref "$REF" >/dev/null
echo "OK: WHATSAPP_APP_SECRET gravado."
