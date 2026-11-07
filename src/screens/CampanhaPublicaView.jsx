// Página PÚBLICA (sem login) de uma campanha: /promo/<slug>. Preço antigo riscado + preço promocional + contagem regressiva.
// O servidor decide a vigência (RPC campanha_publica manda `agora`); o relógio do cliente só interpola a contagem.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { linkWa } from "../lib/ofertaCore";
import { EMPRESA } from "../lib/empresa";
import { offsetServidor, msAte, faseCampanha, contagem, fmtPrazo, mensagemQuero } from "../lib/campanhasCore";
import PrecoDePor from "../components/PrecoDePor";
import { tamanhoExibicao } from "../lib/tamanhos";
import { Loader2, MessageCircle, Clock } from "lucide-react";

const RECHECAR_MS = 5 * 60 * 1000;

async function buscar(slug) {
  try {
    const { data, error } = await supabase.rpc("campanha_publica", { p_slug: slug });
    return error ? undefined : data; // undefined = falha de rede (mantém o que já tem) · null = indisponível
  } catch { return undefined; }
}

export default function CampanhaPublicaView({ slug }) {
  const [estado, setEstado] = useState("carregando"); // carregando | ok | indisponivel
  const [d, setD] = useState(null);
  const [offset, setOffset] = useState(0);
  const [agora, setAgora] = useState(Date.now());
  const [aviso, setAviso] = useState(null);
  const ultima = useRef(0);

  const carregar = useCallback(async () => {
    const r = await buscar(slug);
    if (r === undefined) return null;
    ultima.current = Date.now();
    if (!r || !Array.isArray(r.itens)) { setEstado("indisponivel"); return null; }
    setOffset(offsetServidor(r.agora)); setD(r); setEstado("ok");
    return r;
  }, [slug]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { // contagem: 1 tick por segundo, só interpola
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { // revalida a cada 5 min e ao voltar para a aba
    const t = setInterval(carregar, RECHECAR_MS);
    const vis = () => { if (document.visibilityState === "visible" && Date.now() - ultima.current > 5000) carregar(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [carregar]);

  const fase = d ? faseCampanha(d, offset, agora) : null;
  const alvo = d ? (fase === "agendada" ? d.inicio_em : d.fim_em) : null;
  const restante = d && fase !== "encerrada" ? msAte(alvo, offset, agora) : 0;
  // zerou no relógio: confirma com o servidor (uma vez por transição)
  const faseServidor = d?.estado;
  useEffect(() => { if (d && fase && fase !== faseServidor) carregar(); }, [fase]); // eslint-disable-line react-hooks/exhaustive-deps

  const numero = d?.contato?.whatsapp || EMPRESA.whatsapp;
  const quero = async (e, it) => {
    e.preventDefault();
    const r = await carregar(); // confirma no servidor antes de abrir o WhatsApp
    const dados = r || d;
    const atual = dados.itens.find((x) => x.sku === it.sku) || it;
    if (r && r.estado !== "ativa") { setAviso("A oferta terminou. Os preços voltaram ao normal — chame a gente para saber o valor atual."); return; }
    setAviso(null);
    window.location.assign(linkWa(numero, mensagemQuero(atual, dados, window.location.href)));
  };

  if (estado === "carregando") return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;
  if (estado === "indisponivel") return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div><p className="text-xl font-extrabold text-gray-900">Campanha indisponível</p><p className="text-sm text-gray-500 mt-1">Esse link não está mais ativo.</p></div>
    </div>
  );

  const ativa = fase === "ativa";
  return (
    <div className="min-h-screen bg-gray-50">
      <div className={`sticky top-0 z-10 px-4 py-3 text-white ${ativa ? "bg-red-600" : fase === "agendada" ? "bg-sky-700" : "bg-gray-600"}`}>
        <div className="max-w-xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-extrabold truncate">{d.nome}</p>
            <p className="text-xs opacity-90">
              {ativa ? `Termina em ${fmtPrazo(d.fim_em)}` : fase === "agendada" ? `Começa em ${fmtPrazo(d.inicio_em)}` : "Oferta encerrada"}
            </p>
          </div>
          {fase !== "encerrada" && (
            <div className="flex items-center gap-1.5 font-mono font-extrabold text-lg tabular-nums shrink-0" aria-label="Tempo restante" role="timer">
              <Clock className="w-4 h-4" /> {contagem(restante)}
            </div>
          )}
        </div>
      </div>
      <div className="max-w-xl mx-auto p-4 space-y-4">
        {aviso && <p className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm p-3">{aviso}</p>}
        {fase === "encerrada" && <p className="rounded-xl bg-gray-100 text-gray-700 text-sm p-3">Essa promoção terminou. Os preços abaixo são os atuais.</p>}
        {fase === "agendada" && <p className="rounded-xl bg-sky-50 text-sky-800 text-sm p-3">A promoção ainda não começou. Volte neste link no horário!</p>}
        {d.itens.length === 0 && <p className="text-sm text-gray-500">Nenhuma peça disponível nesta campanha.</p>}
        {d.itens.map((it) => {
          const vendido = it.disponivel === false;
          const tam = tamanhoExibicao({ grupo: it.calcado ? "Calçados" : it.vestuario ? "Vestuário" : "", tamanho: it.tamanho });
          return (
            <article key={it.sku} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {it.foto && <img src={it.foto} alt={it.produto} loading="lazy" className="w-full aspect-square object-contain bg-gray-50" />}
              <div className="p-4 space-y-2">
                <h2 className="font-bold text-gray-900">{it.produto}</h2>
                <PrecoDePor preco={it.preco} precoCheio={ativa ? it.preco_cheio : null} pct={ativa ? it.desconto_pct : null} />
                {it.condicao && <p className="text-sm text-gray-600">{it.condicao}</p>}
                <p className="text-xs text-gray-500">{[tam && `${it.vestuario ? "Tam." : "Nº"} ${tam}`, it.marca, it.medidas, it.cor].filter(Boolean).join(" · ")}</p>
                {vendido ? (
                  <p className="rounded-xl bg-gray-100 text-gray-500 text-center py-3 font-bold">Vendido</p>
                ) : fase === "agendada" ? null : (
                  <a href="#quero" onClick={(e) => quero(e, it)}
                    className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white py-3 font-bold">
                    <MessageCircle className="w-5 h-5" /> Quero este
                  </a>
                )}
              </div>
            </article>
          );
        })}
        <p className="text-center text-xs text-gray-400">Preços e disponibilidade sujeitos a alteração. Peças de outlet, com condição descrita.</p>
      </div>
    </div>
  );
}
