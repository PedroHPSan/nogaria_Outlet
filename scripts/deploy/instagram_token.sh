#!/usr/bin/env bash
# Grava o token do Instagram (@nogariaoutlet) em instagram_oauth SEM exibi-lo e sem deixá-lo em histórico/argumentos.
# 1) Gere o token no app Meta (Instagram API setup with Instagram login → Generate token) logado como @nogariaoutlet.
# 2) Rode:  bash scripts/deploy/instagram_token.sh   (cole o token quando pedir; a digitação não aparece)
set -euo pipefail
REF=yqimfktanresuboqfdti
read -r -s -p "Token do Instagram: " TOKEN; echo
[ -n "$TOKEN" ] || { echo "token vazio"; exit 1; }
# valida o token e descobre o id/usuário (o token vai no header, não na URL)
RESP=$(curl -fsS -H "Authorization: Bearer $TOKEN" "https://graph.instagram.com/v23.0/me?fields=user_id,username,account_type") \
  || { echo "ERRO: a Meta recusou o token (expirado ou sem as permissões)."; exit 1; }
USERID=$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["user_id"])')
USERNAME=$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["username"])')
TIPO=$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("account_type",""))')
echo "Conta: @$USERNAME (id $USERID, tipo $TIPO)"
[ "$USERNAME" = "nogariaoutlet" ] || { read -r -p "O usuário não é @nogariaoutlet. Continuar mesmo assim? [s/N] " R; [ "$R" = "s" ] || exit 1; }
umask 077
SQL=$(mktemp); trap 'rm -f "$SQL"' EXIT
cat > "$SQL" <<SQLEOF
insert into public.instagram_oauth (id, ig_user_id, access_token, expires_at, updated_at)
values (1, '$USERID', '$TOKEN', now() + interval '58 days', now())
on conflict (id) do update set ig_user_id = excluded.ig_user_id, access_token = excluded.access_token,
  expires_at = excluded.expires_at, updated_at = now();
SQLEOF
supabase db query --linked --project-ref "$REF" -f "$SQL" >/dev/null
echo "OK: token gravado em instagram_oauth (validade assumida de 58 dias; o worker renova toda segunda-feira)."
