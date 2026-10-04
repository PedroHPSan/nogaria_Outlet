import React, { useEffect, useState } from "react";
import { Loader2, Boxes, MessageCircle } from "lucide-react";
import { buscarOrcamentoPublico } from "../lib/orcamentos";
import { totais, mensagemAceite } from "../lib/orcamentosCore";
import { fmtBRL } from "../lib/model";
import { EMPRESA } from "../lib/empresa";

// Página PÚBLICA (sem login) do orçamento: /o/<slug>. O RLS só devolve orçamentos
// ENVIADO/RESERVADO ainda válidos; qualquer outro caso cai em "indisponível".
export default function OrcamentoPublicoView({ slug }) {
  const [estado, setEstado] = useState("carregando");
  const [orc, setOrc] = useState(null);

  useEffect(() => {
    let vivo = true;
    buscarOrcamentoPublico(slug).then((d) => {
      if (!vivo) return;
      if (!d) { setEstado("indisponivel"); return; }
      setOrc(d); setEstado("ok");
    });
    return () => { vivo = false; };
  }, [slug]);

  if (estado === "carregando") {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;
  }
  if (estado === "indisponivel") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-center px-8">
        <Boxes className="w-12 h-12 text-gray-300 mb-3" />
        <p className="text-gray-700 font-bold">Orçamento indisponível</p>
        <p className="text-sm text-gray-500 mt-1">Este orçamento expirou ou foi encerrado. Fale com a Nogária Outlet para um novo.</p>
      </div>
    );
  }

  const t = totais(orc.itens, orc.desconto_pct);
  const numero = orc.vendedor_whatsapp || EMPRESA.whatsapp;
  const link = `https://wa.me/${numero}?text=${encodeURIComponent(mensagemAceite(orc))}`;
  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <header className="bg-gray-900 text-white px-4 py-4">
        <h1 className="text-lg font-bold"><span className="text-orange-400">NOGÁRIA</span> OUTLET</h1>
        <p className="text-sm text-gray-200">Orçamento {orc.codigo}{orc.cliente_nome ? ` · ${orc.cliente_nome}` : ""}</p>
      </header>
      <main className="px-4 py-4 max-w-lg mx-auto space-y-3">
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {orc.itens.map((i) => (
            <div key={i.sku} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{i.produto}</p>
                <p className="text-xs text-gray-500">{i.sku}{i.estado ? ` · ${i.estado}` : ""}</p>
              </div>
              <p className="text-sm font-bold text-gray-900">{Number(i.preco) > 0 ? fmtBRL(i.preco) : "Sob consulta"}</p>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-sm space-y-1">
          {t.pct > 0 && <p className="flex justify-between text-gray-600"><span>Desconto {t.pct}%</span><span>- {fmtBRL(t.desconto)}</span></p>}
          <p className="flex justify-between font-bold text-gray-900 text-base"><span>Total</span><span>{fmtBRL(t.total)}</span></p>
          <p className="text-xs text-gray-500">Válido até {new Date(orc.validade).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      </main>
      <div className="fixed bottom-0 inset-x-0 p-3 bg-white border-t border-gray-200">
        <a href={link} target="_blank" rel="noreferrer"
          className="max-w-lg mx-auto flex items-center justify-center gap-2 rounded-xl py-3.5 font-bold bg-emerald-600 text-white">
          <MessageCircle className="w-5 h-5" /> Quero reservar{orc.vendedor_nome ? ` com ${orc.vendedor_nome}` : ""}
        </a>
      </div>
    </div>
  );
}
