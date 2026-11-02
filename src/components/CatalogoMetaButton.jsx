import React, { useEffect, useState } from "react";
import { Loader2, Store } from "lucide-react";
import { publicarNoCatalogo, retirarDoCatalogo, estadoNoCatalogo } from "../lib/catalogoMeta";

// Botão da ficha do item: publica/atualiza/retira o item do catálogo Meta (e da página /i/<sku>).
export default function CatalogoMetaButton({ item, bloqueado }) {
  const [estado, setEstado] = useState(undefined); // undefined = carregando | null = fora | { estado }
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);
  useEffect(() => { estadoNoCatalogo(item.sku).then(setEstado).catch(() => setEstado(null)); }, [item.sku]);
  const publicado = estado?.estado === "publicado";
  const agir = async (fn) => {
    setOcupado(true); setErro(null);
    try { await fn(); setEstado(await estadoNoCatalogo(item.sku)); } catch (e) { setErro(e.message || String(e)); } finally { setOcupado(false); }
  };
  return (
    <>
      <button onClick={() => agir(() => publicarNoCatalogo(item))} disabled={ocupado || bloqueado || estado === undefined}
        className="flex items-center gap-1 bg-emerald-900 rounded-full pl-2.5 pr-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
        title="Publica o item no catálogo do WhatsApp/Instagram e na página /i/<sku>">
        {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Store className="w-3.5 h-3.5" />}
        {publicado ? "Atualizar catálogo" : "Publicar no catálogo"}
      </button>
      {publicado && (
        <button onClick={() => window.confirm("Retirar este item do catálogo?") && agir(() => retirarDoCatalogo(item.sku))} disabled={ocupado}
          className="text-xs text-gray-500 underline">Retirar</button>
      )}
      {erro && <span className="text-xs text-red-600" role="alert">{erro}</span>}
    </>
  );
}
