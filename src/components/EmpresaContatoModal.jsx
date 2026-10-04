// Edita os canais de contato da Nogária (empresa_config) usados em capa, fechamento,
// QR, rodapé e links dos catálogos. Salvar exige a migration de configuração aplicada.
import React, { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { carregarEmpresaConfig, salvarEmpresaConfig } from "../lib/empresaConfig";
import { CHAVES_CONTATO } from "../lib/empresaConfigCore";

export default function EmpresaContatoModal({ user, onClose, onSalvo }) {
  const [valores, setValores] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => { carregarEmpresaConfig().then(setValores); }, []);

  const salvar = async () => {
    setSalvando(true); setErro(null);
    try { await salvarEmpresaConfig(valores, user); onSalvo?.(); onClose(); }
    catch (e) { setErro(e.message || "Falha ao salvar (a migration de configuração já foi aplicada?)."); }
    finally { setSalvando(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Contatos da Nogária</h2>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-400" /></button>
        </div>
        {!valores ? <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p> : (
          <>
            <p className="text-xs text-gray-500">Aparecem na capa, no fechamento, nos QRs e no link público. WhatsApp vazio usa o padrão da empresa.</p>
            {CHAVES_CONTATO.map((c) => (
              <label key={c.chave} className="block text-xs font-semibold text-gray-600">
                {c.rotulo}
                <input value={valores[c.chave] || ""} onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })} placeholder={c.placeholder}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </label>
            ))}
            {erro && <p className="text-xs text-red-600">{erro}</p>}
            <button onClick={salvar} disabled={salvando} className="w-full rounded-xl py-3 font-bold bg-orange-500 text-white disabled:bg-gray-300">
              {salvando ? "Salvando…" : "Salvar contatos"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
