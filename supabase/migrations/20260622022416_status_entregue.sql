-- Novo status de pós-venda: 'ENTREGUE' (depois de 'VENDIDO' no funil). Separa o que
-- foi VENDIDO (pago) do que já foi ENTREGUE/enviado ao comprador.
-- O valor é adicionado ao enum item_status em migração isolada porque um novo valor de
-- enum não pode ser usado na mesma transação em que é criado (mesmo motivo de
-- 20260619c_estado_valores.sql → 20260619d_...). O `do $$` torna a migração segura
-- mesmo que `status` seja uma coluna text (não-enum): nesse caso é um no-op.
do $$ begin
  if exists (select 1 from pg_type where typname = 'item_status') then
    alter type item_status add value if not exists 'ENTREGUE';
  end if;
end $$;
