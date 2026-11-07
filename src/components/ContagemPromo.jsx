// Faixa "promoção termina em 2d 04:13:22". O relógio do servidor (agoraIso) ancora a contagem; ao zerar avisa (onFim)
// para a página confirmar com o servidor.
import React, { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { offsetServidor, msAte, contagem } from "../lib/campanhasCore";

export default function ContagemPromo({ fimIso, agoraIso, nome, onFim }) {
  const offset = useRef(0);
  const avisou = useRef(false);
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => { if (agoraIso) offset.current = offsetServidor(agoraIso); avisou.current = false; }, [agoraIso, fimIso]);
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const ms = msAte(fimIso, offset.current, agora);
  useEffect(() => { if (ms <= 0 && !avisou.current) { avisou.current = true; onFim?.(); } }, [ms, onFim]);
  if (!(ms > 0)) return null;
  return (
    <div role="timer" className="rounded-xl bg-red-600 text-white px-3 py-2 flex items-center justify-between gap-3">
      <span className="text-sm font-bold truncate">{nome ? `🔥 ${nome}` : "🔥 Promoção"} termina em</span>
      <span className="flex items-center gap-1 font-mono font-extrabold tabular-nums shrink-0"><Clock className="w-4 h-4" /> {contagem(ms)}</span>
    </div>
  );
}
