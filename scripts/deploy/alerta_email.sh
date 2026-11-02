#!/usr/bin/env bash
# Grava no Vault as credenciais dos alertas por e-mail (Resend) SEM exibir a chave nem deixá-la em histórico/argumentos.
# 1) Crie uma conta grátis em https://resend.com e gere uma API key (permissão "Sending access").
#    Sem domínio verificado, o Resend só entrega para o e-mail do dono da conta: use esse mesmo e-mail abaixo.
# 2) Rode:  bash scripts/deploy/alerta_email.sh   (cole a chave quando pedir; a digitação não aparece)
set -euo pipefail
read -r -p "E-mail que recebe os alertas: " PARA
case "$PARA" in *@*.*) ;; *) echo "e-mail inválido"; exit 1;; esac
read -r -s -p "API key do Resend: " KEY; echo
[ -n "$KEY" ] || { echo "chave vazia"; exit 1; }
umask 077
SQL=$(mktemp); trap 'rm -f "$SQL"' EXIT
cat > "$SQL" <<SQLEOF
do \$\$ declare id uuid; begin
  select s.id into id from vault.secrets s where s.name = 'alerta_resend_key';
  if id is null then perform vault.create_secret('$KEY', 'alerta_resend_key'); else perform vault.update_secret(id, '$KEY'); end if;
  select s.id into id from vault.secrets s where s.name = 'alerta_email_para';
  if id is null then perform vault.create_secret('$PARA', 'alerta_email_para'); else perform vault.update_secret(id, '$PARA'); end if;
end \$\$;
SQLEOF
supabase db query --linked -f "$SQL" >/dev/null
echo "OK: credenciais gravadas no Vault. O banco verifica a cada 5 min e envia o e-mail quando houver alerta (reenvio a cada 6 h)."
