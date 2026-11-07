// Aviso na ficha do item: ele está em campanha (ativa ou agendada). O "de" fica congelado; mexer no preço de venda
// não altera a promoção em andamento, só o preço depois dela.
import React, { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { campanhasDoItem } from "../lib/campanhas";
import { avisoCampanhaItem, fmtPrazo } from "../lib/campanhasCore";
import { fmtBRL } from "../lib/model";

export default function CampanhaItemAviso({ sku }) {
  const [a, setA] = useState(null);
  useEffect(() => {
    let vivo = true;
    campanhasDoItem(sku).then((l) => vivo && setA(avisoCampanhaItem(l))).catch(() => {});
    return () => { vivo = false; };
  }, [sku]);
  if (!a) return null;
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 mb-4 text-sm text-red-900">
      <p className="font-bold flex items-center gap-1.5"><Megaphone className="w-4 h-4" /> Em campanha: {a.campanha} ({a.ativa ? `até ${fmtPrazo(a.fim_em)}` : `começa em ${fmtPrazo(a.inicio_em)}`})</p>
      <p className="text-xs mt-1">
        "De" congelado em <b>{fmtBRL(a.preco_cheio)}</b> com {String(a.desconto_pct).replace(".", ",")}% off. Mudar o preço de venda agora <b>não altera</b> a promoção em andamento;
        vale só para depois dela (e para quem pagar após o fim, conforme a decisão da equipe).
      </p>
    </div>
  );
}
