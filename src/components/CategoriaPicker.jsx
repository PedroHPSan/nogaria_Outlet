import React, { useState, useRef, useEffect, useMemo } from "react";
import { Check, ChevronDown, Search, Sparkles } from "lucide-react";

// Combobox de categoria: busca na lista fixa (pricing_grupo, via params.grupos) e,
// se allowCustom, permite cadastrar uma categoria nova (com aviso de que não terá
// âncora de preço até existir em pricing_grupo).
const triggerCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 flex items-center justify-between text-left";

export default function CategoriaPicker({ value, onChange, grupos = [], allowCustom = true, sugestao = null }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const lista = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? grupos.filter((g) => g.toLowerCase().includes(s)) : grupos;
  }, [q, grupos]);

  const isCustom = value && !grupos.includes(value);
  const podeCriar =
    allowCustom && q.trim() && !grupos.some((g) => g.toLowerCase() === q.trim().toLowerCase());

  const escolher = (g) => { onChange(g); setOpen(false); setQ(""); };

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={triggerCls}>
        <span className={value ? "text-gray-800" : "text-gray-400"}>{value || "Selecionar categoria"}</span>
        <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>
      {isCustom && (
        <p className="text-[11px] text-amber-600 mt-1">Categoria nova — sem âncora de preço até ser cadastrada.</p>
      )}
      {sugestao && sugestao !== value && (
        <button type="button" onClick={() => onChange(sugestao)}
          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1">
          <Sparkles className="w-3.5 h-3.5" /> Sugerir: {sugestao}
        </button>
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-72 overflow-auto">
          <div className="sticky top-0 bg-white p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar categoria…"
                className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
          <ul className="py-1">
            {lista.map((g) => (
              <li key={g}>
                <button type="button" onClick={() => escolher(g)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 flex items-center justify-between">
                  <span>{g}</span>
                  {value === g && <Check className="w-4 h-4 text-orange-500" />}
                </button>
              </li>
            ))}
            {!lista.length && !podeCriar && (
              <li className="px-3 py-2 text-sm text-gray-400">Nenhuma categoria encontrada.</li>
            )}
            {podeCriar && (
              <li className="border-t border-gray-100">
                <button type="button" onClick={() => escolher(q.trim())}
                  className="w-full text-left px-3 py-2 text-sm text-orange-600 font-semibold hover:bg-orange-50">
                  Usar “{q.trim()}” (categoria nova)
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
