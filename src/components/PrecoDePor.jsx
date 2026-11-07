// Preço "de/por" da promoção: valor antigo riscado, valor com desconto em destaque e selo de %.
// Sem `precoCheio` maior que `preco` mostra só o preço (fora de campanha).
import React from "react";
import { fmtBRL } from "../lib/model";

const brl2 = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function PrecoDePor({ preco, precoCheio, pct }) {
  if (!(Number(preco) > 0)) return null;
  const promo = Number(precoCheio) > Number(preco);
  if (!promo) return <p className="text-3xl font-extrabold text-[#02477e]">{fmtBRL(preco)}</p>;
  return (
    <div>
      <p className="text-sm text-gray-400 line-through">{brl2(precoCheio)}</p>
      <div className="flex items-center gap-2">
        <p className="text-3xl font-extrabold text-[#02477e]">{brl2(preco)}</p>
        {Number(pct) > 0 && <span className="rounded-full bg-red-600 text-white text-xs font-extrabold px-2 py-0.5">-{String(Number(pct)).replace(".", ",")}%</span>}
      </div>
    </div>
  );
}
