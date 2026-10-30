// Cadastro de destinos logísticos e locais de storage. Destinos marcados como "internacional"
// identificam o estoque que vai para a base internacional (Europa). Nada é apagado: desativar
// só tira o destino/local das listas de escolha; itens que já o usam não mudam.
import React, { useCallback, useEffect, useState } from "react";
import { X, Loader2, Globe, Plus, Pencil, ChevronUp, ChevronDown } from "lucide-react";
import {
  destinosCadastrados, criarDestino, atualizarDestino, renomearDestino, moverDestino, criarLocal, atualizarLocal,
  contarItensPorDestino, carregarDestinos,
} from "../lib/destinos";
import { supabase } from "../lib/supabase";

export default function DestinosModal({ onClose }) {
  const [destinos, setDestinos] = useState(destinosCadastrados());
  const [locais, setLocais] = useState([]);
  const [contagem, setContagem] = useState({});
  const [novo, setNovo] = useState({ nome: "", pais: "", internacional: false });
  const [novoLocal, setNovoLocal] = useState({}); // { [destino]: texto }
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [semTabela, setSemTabela] = useState(false);
  const [editando, setEditando] = useState(null); // { id, nome } em renomeação

  const recarregar = useCallback(async () => {
    const ok = await carregarDestinos();
    setSemTabela(!ok);
    const lista = destinosCadastrados();
    setDestinos(lista);
    const { data } = await supabase.from("locais_storage").select("*").order("nome");
    setLocais(data || []);
    contarItensPorDestino(lista.map((d) => d.nome)).then(setContagem);
  }, []);
  useEffect(() => { recarregar(); }, [recarregar]);

  const rodar = async (fn) => {
    setOcupado(true); setErro(null);
    try { await fn(); await recarregar(); } catch (e) { setErro(e.message || String(e)); }
    finally { setOcupado(false); }
  };

  const ordenados = [...destinos].sort((a, b) => a.ordem - b.ordem);
  const nInternacionais = destinos.filter((d) => d.ativo && d.internacional).length;
  const renomear = () => {
    const n = contagem[destinos.find((d) => d.id === editando.id)?.nome] ?? 0;
    if (n > 0 && !window.confirm(`Renomear para "${editando.nome.trim()}"? Os ${n} itens deste destino (e suas caixas) serão atualizados.`)) return;
    rodar(async () => { await renomearDestino(editando.id, editando.nome); setEditando(null); });
  };
  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Destinos e locais de storage</h2>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-400" /></button>
        </div>
        {semTabela && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-2">Cadastro ainda não disponível no banco (migration pendente). Mostrando a lista padrão.</p>}
        {erro && <p className="text-xs text-red-600">{erro}</p>}

        <p className="text-xs text-gray-500">
          {nInternacionais > 0 ? `${nInternacionais} destino(s) internacional(is): use o filtro "Somente internacionais" em Itens, Catálogo e no catálogo rápido.` : "Marque um destino como Internacional para separar o estoque da base europeia."}
        </p>
        {ordenados.map((d, idx) => {
          const meus = locais.filter((l) => l.destino === d.nome);
          return (
            <div key={d.nome} className={`rounded-xl border p-3 space-y-2 ${d.ativo ? "border-gray-200" : "border-gray-100 bg-gray-50 opacity-70"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  {editando?.id === d.id ? (
                    <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); renomear(); }}>
                      <input autoFocus className="rounded-lg border border-gray-300 px-2 py-1 text-sm w-40" value={editando.nome}
                        onChange={(e) => setEditando({ id: d.id, nome: e.target.value })} />
                      <button disabled={ocupado} className="rounded-lg bg-gray-800 text-white text-xs px-2">OK</button>
                      <button type="button" onClick={() => setEditando(null)} className="text-xs text-gray-500">Cancelar</button>
                    </form>
                  ) : (
                    <p className="font-bold text-gray-900 truncate flex items-center gap-1.5">
                      {d.internacional && <Globe className="w-4 h-4 text-sky-600 shrink-0" />}{d.nome}
                      {d.pais && <span className="text-xs font-normal text-gray-500">· {d.pais}</span>}
                      {d.id && d.nome !== "A definir" && (
                        <button aria-label="Renomear" disabled={ocupado} onClick={() => setEditando({ id: d.id, nome: d.nome })}><Pencil className="w-3.5 h-3.5 text-gray-400" /></button>
                      )}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">{contagem[d.nome] ?? "…"} itens</p>
                </div>
                {d.id && (
                  <div className="flex flex-col items-end gap-1 text-xs">
                    <label className="flex items-center gap-1 text-gray-600">
                      <input type="checkbox" checked={!!d.internacional} disabled={ocupado}
                        onChange={(e) => rodar(() => atualizarDestino(d.id, { internacional: e.target.checked }))} /> Internacional
                    </label>
                    <span className="flex items-center">
                      <button aria-label="Subir" disabled={ocupado || idx === 0} onClick={() => rodar(() => moverDestino(d.id, -1))}><ChevronUp className="w-4 h-4 text-gray-400" /></button>
                      <button aria-label="Descer" disabled={ocupado || idx === ordenados.length - 1} onClick={() => rodar(() => moverDestino(d.id, 1))}><ChevronDown className="w-4 h-4 text-gray-400" /></button>
                    </span>
                    {d.nome !== "A definir" && (
                      <button disabled={ocupado} onClick={() => rodar(() => atualizarDestino(d.id, { ativo: !d.ativo }))} className="text-gray-500 underline">
                        {d.ativo ? "Desativar" : "Reativar"}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {d.id && (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-1">
                    {meus.map((l) => (
                      <button key={l.id} disabled={ocupado} onClick={() => rodar(() => atualizarLocal(l.id, { ativo: !l.ativo }))}
                        title={l.ativo ? "Toque para desativar" : "Toque para reativar"}
                        className={`px-2 py-0.5 rounded-full text-xs border ${l.ativo ? "bg-gray-100 border-gray-200 text-gray-700" : "bg-white border-dashed text-gray-400 line-through"}`}>{l.nome}</button>
                    ))}
                  </div>
                  <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); rodar(async () => { await criarLocal(d.nome, novoLocal[d.nome]); setNovoLocal((v) => ({ ...v, [d.nome]: "" })); }); }}>
                    <input className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm" placeholder="Novo local (ex.: corredor B)"
                      value={novoLocal[d.nome] || ""} onChange={(e) => setNovoLocal((v) => ({ ...v, [d.nome]: e.target.value }))} />
                    <button disabled={ocupado} className="rounded-lg bg-gray-800 text-white px-2"><Plus className="w-4 h-4" /></button>
                  </form>
                </div>
              )}
            </div>
          );
        })}

        <form className="rounded-xl border border-dashed border-gray-300 p-3 space-y-2"
          onSubmit={(e) => { e.preventDefault(); rodar(async () => { await criarDestino(novo); setNovo({ nome: "", pais: "", internacional: false }); }); }}>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Novo destino</p>
          <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Nome (ex.: Madrid storage)"
            value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          <div className="flex gap-2">
            <input className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="País (opcional)"
              value={novo.pais} onChange={(e) => setNovo({ ...novo, pais: e.target.value })} />
            <label className="flex items-center gap-1 text-sm text-gray-700">
              <input type="checkbox" checked={novo.internacional} onChange={(e) => setNovo({ ...novo, internacional: e.target.checked })} /> Internacional
            </label>
          </div>
          <button disabled={ocupado || !novo.nome.trim()} className="w-full rounded-lg bg-orange-500 text-white font-bold py-2 disabled:opacity-50 flex items-center justify-center gap-2">
            {ocupado && <Loader2 className="w-4 h-4 animate-spin" />} Adicionar destino
          </button>
        </form>
      </div>
    </div>
  );
}
