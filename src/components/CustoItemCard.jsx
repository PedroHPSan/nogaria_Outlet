// Custo e lucro de UM item na ficha: de onde vem o custo (direto, rateado do lote ou sem custo cadastrado),
// o lucro estimado no preço atual e, se já vendido, o lucro realizado. Usa o mesmo motor de rateio do lote.
import React, { useEffect, useState } from "react";
import { Coins, Loader2 } from "lucide-react";
import { analisarItens } from "../lib/motorPrecoDb";
import { lucroEm } from "../lib/motorPreco";
import { fmtBRL } from "../lib/model";

const money = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export default function CustoItemCard({ item, params }) {
  const [r, setR] = useState(undefined); // undefined = carregando · null = sem dados · objeto = resultado
  const chave = `${item.sku}|${item.lote}|${item.custo_direto}|${item.canal_principal}|${item.peso_real_kg ?? item.peso_kg}`;

  useEffect(() => {
    let cancel = false;
    analisarItens([item], params)
      .then((m) => !cancel && setR(m.get(item.sku) || null))
      .catch(() => !cancel && setR(null));
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  if (r === undefined) return <div className="bg-white rounded-2xl border border-gray-200 px-4 py-4 mb-4 shadow-sm"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>;
  if (r === null) return null;

  const direto = item.custo_direto != null && item.custo_direto !== "";
  // Lote sem custo cadastrado pode chegar aqui só com o frete estimado: custo alocado zero = sem custo.
  const semCusto = r.semCusto || (!direto && !(r.custoAloc > 0));
  const origem = semCusto ? "Lote sem custo cadastrado"
    : direto ? "Custo direto do produto"
    : r.custoOrigem?.startsWith("custeio") ? "Rateado do lote (custeio cadastrado)" : "Rateado do lote (custo do lote)";
  const preco = Number(item.preco_ideal) > 0 ? Number(item.preco_ideal) : Number(item.preco_sugerido) > 0 ? Number(item.preco_sugerido) : null;
  const est = preco && !semCusto ? lucroEm(preco, r.base, r.canal) : null;
  const vendido = item.status === "VENDIDO" || item.status === "ENTREGUE";
  const realizado = vendido && Number(item.valor_vendido) > 0 && !semCusto
    ? Number(item.valor_vendido) - (Number(item.taxa_venda) || 0) - (Number(item.frete_pago) || 0) - r.base : null;

  const linha = (rot, val, forte) => (
    <div className="flex justify-between text-sm py-0.5"><span className="text-gray-500">{rot}</span><b className={forte ? "text-gray-900" : "text-gray-700"}>{val}</b></div>
  );
  return (
    <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3 mb-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pb-1.5 flex items-center gap-1.5">
        <Coins className="w-3.5 h-3.5 text-emerald-600" /> Custo e lucro
      </h3>
      {semCusto ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">Este lote ainda não tem custo cadastrado — cadastre pelo Painel (Lotes) para medir o lucro deste item.</p>
      ) : (<>
        {linha("Custo do item", money(r.custoAloc), true)}
        <p className="text-[11px] text-gray-400 -mt-0.5 pb-1">{origem}</p>
        {linha("Embalagem estimada", money(r.embalagem))}
        {linha("Base (custo + embalagem)", money(r.base))}
        {est && (<>
          <div className="border-t border-gray-100 my-1.5" />
          {linha(`Preço atual (${fmtBRL(preco)})`, `${money(est.lucro)} · ${(est.margem * 100).toFixed(0)}%`, true)}
          <p className="text-[11px] text-gray-400 -mt-0.5">Lucro estimado após taxas e frete do canal.</p>
        </>)}
        {realizado != null && (<>
          <div className="border-t border-gray-100 my-1.5" />
          {linha("Lucro realizado na venda", money(realizado), true)}
        </>)}
      </>)}
    </div>
  );
}
