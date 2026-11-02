#!/usr/bin/env bash
# Gera e grava os segredos do omnichannel (só imprime, no fim, o verify token e a URL do feed para configurar a Meta):
#  - Edge Function secrets: CRON_SECRET, CATALOGO_FEED_TOKEN, WHATSAPP_VERIFY_TOKEN, PUBLIC_SITE_URL
#  - Vault do banco: sync_canais_url / sync_canais_secret (o cron passa a chamar o worker)
# Uso (uma vez, do seu terminal):  bash scripts/deploy/segredos.sh
# Reexecutar GERA NOVOS valores e troca todos (útil para rotacionar); as URLs/tokens já cadastrados na Meta precisam ser atualizados.
set -euo pipefail
REF=yqimfktanresuboqfdti
SITE=${PUBLIC_SITE_URL:-https://www.phps.app}
umask 077
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
CRON=$(openssl rand -hex 24)
{ echo "CRON_SECRET=$CRON"; echo "CATALOGO_FEED_TOKEN=$(openssl rand -hex 24)"; echo "WHATSAPP_VERIFY_TOKEN=$(openssl rand -hex 16)"; echo "PUBLIC_SITE_URL=$SITE"; } > "$TMP"
supabase secrets set --env-file "$TMP" --project-ref "$REF" >/dev/null
echo "OK: segredos das Edge Functions gravados"
# Vault: cria ou atualiza (sem imprimir o valor)
supabase db query --linked "
do \$\$ declare id uuid; begin
  select s.id into id from vault.secrets s where s.name = 'sync_canais_url';
  if id is null then perform vault.create_secret('https://$REF.supabase.co/functions/v1/sync-canais', 'sync_canais_url');
  else perform vault.update_secret(id, 'https://$REF.supabase.co/functions/v1/sync-canais'); end if;
  select s.id into id from vault.secrets s where s.name = 'sync_canais_secret';
  if id is null then perform vault.create_secret('$CRON', 'sync_canais_secret');
  else perform vault.update_secret(id, '$CRON'); end if;
end \$\$;" >/dev/null
echo "OK: Vault atualizado (sync_canais_url / sync_canais_secret)"
echo
echo "Para configurar a Meta (guarde; os secrets das funções não podem ser lidos de volta):"
echo "  Webhook do WhatsApp  URL:   https://$REF.supabase.co/functions/v1/whatsapp-webhook"
echo "  Webhook do WhatsApp  Verify token: $(grep '^WHATSAPP_VERIFY_TOKEN=' "$TMP" | cut -d= -f2)"
echo "  Feed do catálogo (Commerce Manager): https://$REF.supabase.co/functions/v1/catalogo-meta-feed?t=$(grep '^CATALOGO_FEED_TOKEN=' "$TMP" | cut -d= -f2)"
