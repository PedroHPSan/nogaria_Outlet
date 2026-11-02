#!/usr/bin/env bash
# Grava META_CATALOG_TOKEN (e META_CATALOG_ID) nos secrets das Edge Functions SEM exibir o token nem deixá-lo em histórico/argumentos.
# 1) No Meta Business (Configurações → Usuários do sistema), gere um token do usuário do sistema com a permissão catalog_management
#    e acesso ao catálogo "Nogaria Outlet".  2) Rode:  bash scripts/deploy/catalogo_token.sh   (cole o token; a digitação não aparece)
set -euo pipefail
REF=yqimfktanresuboqfdti
CATALOG_ID=${META_CATALOG_ID:-1799534318152512}
read -r -s -p "Token do catálogo (catalog_management): " TOKEN; echo
[ -n "$TOKEN" ] || { echo "token vazio"; exit 1; }
# valida: o token precisa enxergar o catálogo (o token vai no header, não na URL)
NOME=$(curl -fsS -H "Authorization: Bearer $TOKEN" "https://graph.facebook.com/v23.0/$CATALOG_ID?fields=name" | python3 -c 'import sys,json; print(json.load(sys.stdin)["name"])') \
  || { echo "ERRO: a Meta recusou o token ou ele não enxerga o catálogo $CATALOG_ID."; exit 1; }
echo "Catálogo: $NOME ($CATALOG_ID)"
umask 077
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
{ echo "META_CATALOG_TOKEN=$TOKEN"; echo "META_CATALOG_ID=$CATALOG_ID"; } > "$TMP"
supabase secrets set --env-file "$TMP" --project-ref "$REF" >/dev/null
echo "OK: META_CATALOG_TOKEN e META_CATALOG_ID gravados. A retirada do catálogo passa a ser imediata (venda/reserva)."
