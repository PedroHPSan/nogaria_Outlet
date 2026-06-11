import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { Package, Loader2, LogIn } from "lucide-react";

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
          <div className="mx-auto w-16 h-16 rounded-2xl bg-orange-500 flex items-center justify-center mb-4">
            <Package className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">NOGÁRIA OUTLET</h1>
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
