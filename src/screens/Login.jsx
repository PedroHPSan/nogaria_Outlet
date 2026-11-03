import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { Loader2, LogIn } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  const entrar = async () => {
    setErro("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    if (error) setErro("E-mail ou senha incorretos.");
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo-nogaria.png" alt="Nogária" className="mx-auto h-10 w-auto" />
          <span className="inline-block mt-2 bg-orange-500 text-brand-deep font-extrabold text-xs tracking-[0.35em] pl-3 pr-2 py-1.5 rounded-md leading-none">OUTLET</span>
          <p className="text-gray-500 mt-1">Catálogo & checklist da operação</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-3">
          <input
            type="email" inputMode="email" placeholder="E-mail" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <input
            type="password" placeholder="Senha" value={senha}
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && entrar()}
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <button
            onClick={entrar} disabled={busy || !email || !senha}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold rounded-xl py-3 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
            Entrar
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-6 text-center">
          Acesso restrito a Pedro e Bárbara. As contas são criadas no painel do Supabase (Authentication → Users).
        </p>
      </div>
    </div>
  );
}
