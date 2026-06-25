import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { preflightAmazon } from "../lib/marketplace/preflight";
import { getAdapter } from "../lib/marketplace/adapter";
import { Upload, CheckCircle2, XCircle, AlertTriangle, Loader2, ShoppingBag } from "lucide-react";

// Canais com adapter de publicação (Amazon na v1).
const CANAIS = [["amazon", "Amazon"]];

const ESTADO_BADGE = {
  publicado: "bg-emerald-100 text-emerald-700",
  publicando: "bg-sky-100 text-sky-700",
  erro: "bg-red-100 text-red-700",
  pausado: "bg-gray-200 text-gray-600",
};

// Seção "Publicar" da ficha: checklist do pre-flight + botão por canal. O gate aqui é UX;
// a Edge re-valida tudo no servidor. Lê/atualiza listing_state do SKU.
export default function PublishPanel({ item }) {
  const [listing, setListing] = useState(null);
  const [publicando, setPublicando] = useState(null); // canal em publicação
  const [result, setResult] = useState(null);

  const carregar = useCallback(async () => {
    if (!item?.sku) return;
    // listing_state pode não existir até a migration ser aplicada — falha silenciosa.
    const { data } = await supabase.from("listing_state").select("*").eq("sku", item.sku).eq("canal", "amazon").maybeSingle();
    setListing(data || null);
  }, [item?.sku]);
  useEffect(() => { carregar(); }, [carregar]);

  const pf = preflightAmazon(item);
  const jaPublicado = listing?.estado === "publicado";

  const publicar = async (canal) => {
    setPublicando(canal);
    setResult(null);
    const r = await getAdapter(canal)?.publicar(item.sku);
    setResult(r || { ok: false, erros: [{ msg: "Canal não suportado." }] });
    setPublicando(null);
    carregar();
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-3 shadow-sm mb-4">
      <div className="flex items-center gap-2 text-gray-800">
        <ShoppingBag className="w-4 h-4 text-orange-500" />
        <span className="text-sm font-bold">Publicar</span>
        {listing?.estado && (
          <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-semibold ${ESTADO_BADGE[listing.estado] || "bg-gray-100 text-gray-600"}`}>
            {listing.estado}
          </span>
        )}
      </div>

      {/* Checklist do pre-flight */}
      <div className="space-y-1">
        {pf.checks.map((c) => (
          <div key={c.id} className="flex items-start gap-2 text-sm">
            {c.ok
              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
              : c.bloqueante
                ? <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                : <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />}
            <div className="min-w-0">
              <span className={c.ok ? "text-gray-700" : c.bloqueante ? "text-red-700 font-medium" : "text-amber-700"}>{c.label}</span>
              {!c.ok && c.motivo && <p className="text-xs text-gray-400">{c.motivo}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Botão por canal */}
      {CANAIS.map(([canal, label]) => (
        <button key={canal} type="button" disabled={!pf.ok || jaPublicado || publicando === canal}
          onClick={() => publicar(canal)}
          className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white rounded-xl py-3 font-semibold active:bg-black disabled:opacity-40 disabled:cursor-not-allowed">
          {publicando === canal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {jaPublicado ? `Publicado na ${label}` : `Publicar na ${label}`}
        </button>
      ))}
      {!pf.ok && <p className="text-xs text-gray-400 text-center">Resolva os itens em vermelho para liberar a publicação.</p>}

      {/* Resultado da última ação */}
      {result?.dry_run && (
        <p className="text-xs text-amber-600">Dry-run: payload montado, publicação real desligada (AMZ_DRY_RUN).</p>
      )}
      {result && result.ok === false && (
        <div className="text-xs text-red-600">{(result.erros || []).map((e) => e.msg).join("; ") || "Falha ao publicar."}</div>
      )}
      {listing?.external_listing_id && (
        <p className="text-xs text-gray-500">ID do anúncio: <span className="font-mono">{listing.external_listing_id}</span></p>
      )}
      {listing?.estado === "erro" && listing?.ultimo_erro && (
        <p className="text-xs text-red-500">{listing.ultimo_erro}</p>
      )}
    </div>
  );
}
