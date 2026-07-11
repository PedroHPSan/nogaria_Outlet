import React, { useState, useEffect, useCallback, Suspense } from "react";
import {
  listarSalas, buscarSala, criarSala, atualizarSala, conteudoSala,
  alocarCaixaNaSala, alocarItemNaSala, removerCaixaDaSala, removerItemDaSala, historicoSala,
} from "../lib/salas";
import { parseCodigoLido } from "../lib/salasFormat";
import { buildRoomLabel } from "../lib/labels";
import { buscarViasImpressaoSala } from "../lib/printLog";
import { CLASSE_STYLE } from "../lib/model";
import {
  X, Loader2, ScanLine, ArrowRight, AlertTriangle, DoorOpen, Package, Boxes,
  ChevronRight, ChevronLeft, Plus, Search, Printer, QrCode, History, Trash2, Pencil,
} from "lucide-react";

const BarcodeScanner = React.lazy(() => import("./BarcodeScanner"));
const LazyLabelPrint = React.lazy(() => import("../components/labels/LabelPrint"));

const eventoSalaLabel = (a) => ({
  "sala:criada": "sala criada", "sala:editada": "sala editada",
  "caixa:sala": "caixa alocada", "item:sala": "item alocado",
  "etiqueta_sala:impressa": "etiqueta impressa",
}[a] || a);

export default function SalasScreen({ user, onClose, onOpenItem }) {
  const [fase, setFase] = useState("lista"); // "lista" | "scan" | "buscando" | "detalhe"
  const [salas, setSalas] = useState([]);
  const [sala, setSala] = useState(null);
  const [conteudo, setConteudo] = useState({ caixas: [], itensSoltos: [] });
  const [hist, setHist] = useState([]);
  const [erro, setErro] = useState(null);
  const [manual, setManual] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [criando, setCriando] = useState(false);

  const carregarLista = useCallback(async () => { setSalas(await listarSalas()); }, []);
  useEffect(() => { carregarLista(); }, [carregarLista]);

  const abrir = async (texto) => {
    const cod = parseCodigoLido(texto).codigo;
    if (!cod) return;
    setFase("buscando"); setErro(null);
    try {
      const s = await buscarSala(cod);
      if (!s) { setErro(`Nenhuma sala com o código "${cod}".`); setFase(salas.length ? "lista" : "scan"); return; }
      setSala(s);
      setConteudo(await conteudoSala(s.codigo));
      setHist(await historicoSala(s.codigo));
      setFase("detalhe");
    } catch (e) { setErro("Falha ao buscar: " + (e.message || String(e))); setFase("lista"); }
  };

  const recarregar = async () => {
    if (!sala) return;
    setSala(await buscarSala(sala.codigo));
    setConteudo(await conteudoSala(sala.codigo));
    setHist(await historicoSala(sala.codigo));
  };

  const voltarLista = async () => { setSala(null); setErro(null); setManual(""); await carregarLista(); setFase("lista"); };

  const criar = async (e) => {
    e.preventDefault();
    const nome = novoNome.trim();
    if (!nome) return;
    setCriando(true); setErro(null);
    try { const s = await criarSala({ nome }, user); setNovoNome(""); await carregarLista(); abrir(s.codigo); }
    catch (err) { setErro(err.message || String(err)); }
    finally { setCriando(false); }
  };

  if (fase === "detalhe" && sala) {
    return (
      <SalaDetalhe sala={sala} conteudo={conteudo} hist={hist} user={user}
        onBack={voltarLista} onClose={onClose} onOpenItem={onOpenItem} onChanged={recarregar} />
    );
  }

  if (fase === "buscando") {
    return <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;
  }

  if (fase === "scan") {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <BarcodeScanner qr onClose={() => setFase("lista")} onDetected={abrir}
            title="Sala por QR — escaneie a etiqueta" hint="Aponte para o QR da porta da sala." />
        </Suspense>
        <div className="absolute bottom-0 inset-x-0 bg-black/80 px-4 py-3">
          {erro && <p className="text-amber-300 text-xs mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {erro}</p>}
          <form onSubmit={(e) => { e.preventDefault(); abrir(manual); }} className="flex gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="ou digite o código (ex.: SALA-001)"
              autoCapitalize="characters" autoComplete="off"
              className="flex-1 rounded-lg border border-gray-600 bg-gray-900 text-white px-3 py-2.5 text-sm font-mono placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500" />
            <button type="submit" className="px-4 rounded-lg bg-orange-500 text-white font-semibold flex items-center gap-1 text-sm">Abrir <ArrowRight className="w-4 h-4" /></button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-1.5"><DoorOpen className="w-4 h-4" /> Salas</span>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
        </div>
      </div>

      <div className="bg-white border-b border-gray-200 px-4 py-3 space-y-2">
        <div className="flex gap-2">
          <button onClick={() => { setErro(null); setManual(""); setFase("scan"); }}
            className="flex-1 flex items-center justify-center gap-2 bg-gray-900 text-white rounded-xl py-2.5 text-sm font-bold active:bg-gray-800">
            <ScanLine className="w-4 h-4" /> Escanear QR
          </button>
          <form onSubmit={(e) => { e.preventDefault(); abrir(manual); }} className="flex-1 flex gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="código (SALA-001)"
              autoCapitalize="characters" autoComplete="off"
              className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" />
            <button type="submit" aria-label="Abrir" className="px-3 rounded-lg bg-orange-500 text-white"><Search className="w-4 h-4" /></button>
          </form>
        </div>
        <form onSubmit={criar} className="flex gap-2">
          <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nova sala (ex.: Galpão A)"
            className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button type="submit" disabled={criando || !novoNome.trim()} className="px-3 rounded-lg bg-emerald-600 text-white flex items-center gap-1 text-sm font-semibold disabled:opacity-50">
            {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {erro && <p className="text-sm text-red-600 mb-3 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}
        {!salas.length ? (
          <p className="text-sm text-gray-400 text-center py-10">Nenhuma sala ainda. Crie a primeira acima.</p>
        ) : (
          <div className="space-y-1.5">
            {salas.map((s) => (
              <button key={s.codigo} onClick={() => abrir(s.codigo)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
                <DoorOpen className="w-5 h-5 text-gray-400" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-gray-900">{s.codigo}</span>
                    <span className="text-sm text-gray-700 truncate">{s.nome}</span>
                  </div>
                  {s.observacao && <p className="text-xs text-gray-400 truncate">{s.observacao}</p>}
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SalaDetalhe({ sala, conteudo, hist, user, onBack, onClose, onOpenItem, onChanged }) {
  const [printLabels, setPrintLabels] = useState(null);
  const [vias, setVias] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMsg, setScanMsg] = useState(null); // { tom, texto }
  const [pendente, setPendente] = useState(null); // { sku, caixa_id } aguardando confirmar retirada
  const [erro, setErro] = useState(null);
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(sala.nome || "");
  const [obs, setObs] = useState(sala.observacao || "");

  const carregarVias = useCallback(async () => {
    const m = await buscarViasImpressaoSala([sala.codigo]);
    setVias(m[sala.codigo] || { vias: 0, ultima: null });
  }, [sala.codigo]);
  useEffect(() => { carregarVias(); }, [carregarVias]);

  const imprimir = () => setPrintLabels([buildRoomLabel(sala)]);
  const fecharImpressao = async () => { setPrintLabels(null); await carregarVias(); };

  const salvarEdicao = async () => {
    setErro(null);
    try { await atualizarSala(sala.codigo, { nome: nome.trim() || sala.codigo, observacao: obs.trim() || null }, user); setEditando(false); await onChanged(); }
    catch (e) { setErro(e.message || String(e)); }
  };

  const handleScan = async (texto) => {
    const { tipo, codigo } = parseCodigoLido(texto);
    setPendente(null);
    try {
      if (tipo === "CAIXA") {
        await alocarCaixaNaSala(codigo, sala.codigo, user);
        await onChanged();
        setScanMsg({ tom: "ok", texto: `${codigo} alocada nesta sala ✓` });
      } else if (tipo === "ITEM") {
        const r = await alocarItemNaSala(codigo, sala.codigo, user);
        if (r.precisaConfirmar) {
          setPendente({ sku: codigo, caixa_id: r.caixa_id });
          setScanMsg({ tom: "warn", texto: `${codigo} está na caixa ${r.caixa_id}` });
        } else {
          await onChanged();
          setScanMsg({ tom: "ok", texto: `${codigo} alocado nesta sala ✓` });
        }
      } else if (tipo === "SALA") {
        setScanMsg({ tom: "dup", texto: `${codigo} é uma sala — escaneie caixas/itens` });
      } else {
        setScanMsg({ tom: "warn", texto: "Código não reconhecido" });
      }
    } catch (e) { setScanMsg({ tom: "err", texto: e.message || String(e) }); }
  };

  const confirmarRetirada = async () => {
    if (!pendente) return;
    setErro(null);
    try {
      await alocarItemNaSala(pendente.sku, sala.codigo, user, { forcarRetirarDaCaixa: true });
      setScanMsg({ tom: "ok", texto: `${pendente.sku} retirado de ${pendente.caixa_id} e alocado ✓` });
      setPendente(null);
      await onChanged();
    } catch (e) { setErro(e.message || String(e)); }
  };

  const tirarCaixa = async (codigo) => { try { await removerCaixaDaSala(codigo, user); await onChanged(); } catch (e) { setErro(e.message || String(e)); } };
  const tirarItem = async (sku) => { try { await removerItemDaSala(sku, user); await onChanged(); } catch (e) { setErro(e.message || String(e)); } };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-300"><ChevronLeft className="w-5 h-5" /> Salas</button>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-lg font-bold text-orange-400">{sala.codigo}</span>
          <span className="text-base text-gray-200">{sala.nome}</span>
        </div>
        <p className="text-3xl font-bold mt-2">{conteudo.caixas.length} <span className="text-base text-gray-400">caixa(s)</span> · {conteudo.itensSoltos.length} <span className="text-base text-gray-400">item(ns) solto(s)</span></p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {erro && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}

        {/* Cabeçalho: editar + etiqueta + encher */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2.5">
          {editando ? (
            <>
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da sala"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              <div className="flex gap-2">
                <button onClick={salvarEdicao} className="flex-1 bg-orange-500 text-white rounded-xl py-2 text-sm font-bold active:bg-orange-600">Salvar</button>
                <button onClick={() => { setEditando(false); setNome(sala.nome || ""); setObs(sala.observacao || ""); }} className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-2 text-sm font-semibold">Cancelar</button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditando(true)} className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 bg-white rounded-xl py-2.5 text-sm font-semibold active:bg-gray-100">
                <Pencil className="w-4 h-4" /> Editar
              </button>
              <button onClick={imprimir} className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 bg-white rounded-xl py-2.5 text-sm font-semibold active:bg-gray-100">
                <Printer className="w-4 h-4" /> Etiqueta{vias?.vias > 0 ? ` · ${vias.vias + 1}ª via` : ""}
              </button>
            </div>
          )}
          <button onClick={() => { setScanMsg(null); setPendente(null); setScanOpen(true); }}
            className="w-full flex items-center justify-center gap-1.5 bg-gray-900 text-white rounded-xl py-2.5 text-sm font-bold active:bg-gray-800">
            <QrCode className="w-4 h-4" /> Encher sala (escanear caixas/itens)
          </button>
        </div>

        {/* Caixas na sala */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Caixas na sala</p>
          {!conteudo.caixas.length ? (
            <p className="text-sm text-gray-400">Nenhuma caixa.</p>
          ) : (
            <div className="space-y-1.5">
              {conteudo.caixas.map((c) => (
                <div key={c.codigo} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3">
                  {c.tipo === "MALA" ? <Boxes className="w-5 h-5 text-gray-400" /> : <Package className="w-5 h-5 text-gray-400" />}
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-sm font-bold text-gray-900">{c.codigo}</span>
                    <p className="text-xs text-gray-500 truncate">{c.destino || "sem destino"}</p>
                  </div>
                  <button onClick={() => tirarCaixa(c.codigo)} aria-label="Remover da sala" className="p-1.5 text-gray-400 active:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Itens soltos na sala */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Itens soltos na sala</p>
          {!conteudo.itensSoltos.length ? (
            <p className="text-sm text-gray-400">Nenhum item solto.</p>
          ) : (
            <div className="space-y-1.5">
              {conteudo.itensSoltos.map((it) => (
                <div key={it.sku} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3">
                  <button onClick={() => onOpenItem?.(it)} className="flex-1 min-w-0 text-left active:opacity-70">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                      {it.classe && <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${CLASSE_STYLE[it.classe] || "bg-gray-400 text-white"}`}>{it.classe}</span>}
                    </div>
                    <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                  </button>
                  <button onClick={() => tirarItem(it.sku)} aria-label="Remover da sala" className="p-1.5 text-gray-400 active:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Histórico */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Histórico da sala</p>
          {!hist.length ? <p className="text-sm text-gray-400">Sem histórico ainda.</p> : (
            <div className="space-y-1">
              {hist.map((e) => (
                <div key={e.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="text-gray-800">{eventoSalaLabel(e.acao)}</span>
                  {e.detalhe && <span className="text-gray-500"> · {e.detalhe}</span>}
                  <p className="text-[11px] text-gray-400">{e.usuario} · {new Date(e.ts).toLocaleString("pt-BR")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Impressão da etiqueta da sala */}
      {printLabels && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] bg-white flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <LazyLabelPrint labels={printLabels} user={user} onClose={fecharImpressao} />
        </Suspense>
      )}

      {/* Scanner contínuo: encher a sala */}
      {scanOpen && (
        <>
          <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
            <BarcodeScanner qr continuous onClose={() => setScanOpen(false)} onDetected={handleScan}
              title="Encher sala" hint="Escaneie caixas (CX/MALA) ou itens soltos (NOG)." />
          </Suspense>
          <div className="fixed inset-x-0 bottom-0 z-[70] px-4 pb-4 pt-3 bg-gradient-to-t from-black/90 to-transparent">
            <div className="max-w-lg mx-auto space-y-2">
              {scanMsg && (
                <p className={`text-center text-sm font-bold rounded-lg py-2 ${
                  scanMsg.tom === "ok" ? "bg-emerald-500 text-white"
                    : scanMsg.tom === "dup" ? "bg-sky-500 text-white"
                    : scanMsg.tom === "warn" ? "bg-amber-500 text-white"
                    : "bg-red-500 text-white"}`}>{scanMsg.texto}</p>
              )}
              {pendente && (
                <button onClick={confirmarRetirada}
                  className="w-full bg-orange-500 text-white rounded-xl py-3 font-bold active:bg-orange-600">
                  Retirar {pendente.sku} da caixa {pendente.caixa_id} e dar entrada nesta sala
                </button>
              )}
              <button onClick={() => setScanOpen(false)} className="w-full bg-white text-gray-900 rounded-xl py-3 font-bold active:bg-gray-100">Concluir</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
