// Conecta o número oficial do outlet pelo Cadastro Incorporado da Meta, em modo coexistência (o app WhatsApp Business continua
// funcionando no celular). A janela da Meta devolve um code + waba/número; o servidor (whatsapp-signup) conclui — o segredo do app nunca vem ao navegador.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, Loader2, MessageCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fmtBrasilia } from "../lib/filaPublicacao";

const APP_ID = "1737544261422773";           // app Meta "Nogaria Outlet"
const CONFIG_ID = "1118492204129948";        // configuração de Login do Facebook para Empresas (Cadastro Incorporado)
const EVENTOS_FIM = ["FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", "FINISH"];

function carregarSdk() {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((ok, falha) => {
    window.fbAsyncInit = () => { window.FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: "v23.0" }); ok(window.FB); };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/pt_BR/sdk.js"; s.async = true; s.defer = true; s.crossOrigin = "anonymous";
    s.onerror = () => falha(new Error("Não consegui carregar o SDK da Meta (bloqueador de anúncios?)."));
    document.body.appendChild(s);
  });
}

export default function ConectarWhatsAppScreen({ onClose }) {
  const [conexao, setConexao] = useState(undefined); // undefined = carregando; null = nenhuma
  const [etapa, setEtapa] = useState("");
  const [erro, setErro] = useState(null);
  const dados = useRef({ code: null, waba_id: null, phone_number_id: null });

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("whatsapp_conexao");
    if (error) { setErro(error.message); setConexao(null); return; }
    setConexao(data?.[0] ?? null);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const concluir = useCallback(async () => {
    const { code, waba_id, phone_number_id } = dados.current;
    if (!code || !waba_id || !phone_number_id) return; // espera as duas metades (login + evento da janela)
    setEtapa("Concluindo no servidor…");
    const { data, error } = await supabase.functions.invoke("whatsapp-signup", { body: { code, waba_id, phone_number_id } });
    dados.current = { code: null, waba_id: null, phone_number_id: null };
    if (error || data?.error) { setErro(data?.error || error.message); setEtapa(""); return; }
    setEtapa(""); await carregar();
  }, [carregar]);

  useEffect(() => {
    const ouvir = (e) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(e.origin).hostname)) return;
      let m; try { m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
      if (m?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (EVENTOS_FIM.includes(m.event)) { dados.current.waba_id = m.data?.waba_id ?? null; dados.current.phone_number_id = m.data?.phone_number_id ?? null; concluir(); }
      else if (m.event === "CANCEL") { setEtapa(""); setErro("Cadastro cancelado na janela da Meta."); }
    };
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
  }, [concluir]);

  const conectar = async () => {
    setErro(null); setEtapa("Abrindo a janela da Meta…");
    try {
      const FB = await carregarSdk();
      FB.login((resp) => {
        const code = resp?.authResponse?.code;
        if (!code) { setEtapa(""); setErro("A Meta não devolveu autorização (janela fechada ou recusada)."); return; }
        dados.current.code = code; concluir();
      }, {
        config_id: CONFIG_ID, response_type: "code", override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      });
    } catch (e) { setEtapa(""); setErro(e.message || String(e)); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-emerald-600" />
        <h2 className="font-bold text-gray-900">Conectar o WhatsApp do outlet</h2>
        <button onClick={onClose} aria-label="Fechar" className="ml-auto"><X className="w-6 h-6 text-gray-400" /></button>
      </div>
      <div className="p-4 space-y-3 overflow-y-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-xs text-gray-700 space-y-1.5">
          <p className="font-bold">Coexistência: o aplicativo WhatsApp Business continua no celular</p>
          <p>Quem for conectar (Bárbara) precisa estar com o celular do número oficial na mão, com o <b>WhatsApp Business</b> atualizado (2.24.17 ou mais novo). A Meta mostra um QR code para ler no aplicativo; depois, deixe o aplicativo aberto por cerca de 24 h para sincronizar as conversas.</p>
        </div>
        {conexao === undefined && <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}
        {conexao && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs space-y-1">
            <p className="font-bold text-emerald-800">Conectado: {conexao.display_phone || conexao.phone_number_id}{conexao.verified_name ? ` · ${conexao.verified_name}` : ""}</p>
            <p className="text-emerald-700">Atualizado {fmtBrasilia(conexao.atualizado_em)}{conexao.expires_em ? ` · token vale até ${fmtBrasilia(conexao.expires_em)}` : ""}</p>
            <p className="text-emerald-700">Contatos: {conexao.sync_contatos || "—"} · Histórico: {conexao.sync_historico || "—"}</p>
          </div>
        )}
        {erro && <p className="text-xs text-red-600">{erro}</p>}
        <button onClick={conectar} disabled={!!etapa} className="w-full px-3 py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-50">
          {etapa ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {etapa}</span> : conexao ? "Reconectar" : "Conectar número"}
        </button>
      </div>
    </div>
  );
}
