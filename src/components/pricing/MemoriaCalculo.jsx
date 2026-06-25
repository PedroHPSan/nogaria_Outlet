import React from "react";
import { ChevronDown } from "lucide-react";
import Ajuda from "./Ajuda";

const pct = (f) => `${Math.round((f ?? 0) * 100)}%`;

function Linha({ op, label, valor, ajuda, termo, fmtBRL, forte, cor }) {
  return (
    <div className={`flex items-center justify-between gap-2 text-xs ${forte ? "font-bold text-gray-900" : "text-gray-600"}`}>
      <span className="flex items-center gap-1 min-w-0">
        {op && <span className="text-gray-400 w-3 flex-shrink-0">{op}</span>}
        <span className="truncate">{label}</span>
        {(ajuda || termo) && <Ajuda termo={termo} texto={ajuda} />}
      </span>
      <span className={`flex-shrink-0 tabular-nums ${cor || (forte ? "text-gray-900" : "text-gray-700")}`}>
        {valor != null ? fmtBRL(valor) : "—"}
      </span>
    </div>
  );
}

function Bloco({ resumo, resumoValor, fmtBRL, children, aberto, onToggle }) {
  return (
    <details className="rounded-xl border border-gray-100" open={aberto} onToggle={onToggle}>
      <summary className="flex items-center justify-between cursor-pointer list-none px-2.5 py-2">
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase text-gray-500">
          {resumo}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-gray-800 tabular-nums">{fmtBRL(resumoValor)}</span>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </span>
      </summary>
      <div className="px-2.5 pb-2.5 space-y-1.5">{children}</div>
    </details>
  );
}

// Como chegamos no PISO (preço mínimo p/ não ter prejuízo): soma dos custos ÷ (1 − taxas − margem).
export function MemoriaPiso({ memoria, fmtBRL }) {
  const m = memoria.piso;
  return (
    <Bloco resumo={<>Piso — por quê? <Ajuda termo="piso" /></>} resumoValor={m.resultado} fmtBRL={fmtBRL}>
      {m.componentes.map((c, i) => (
        <Linha key={c.label} op={i === 0 ? "" : "+"} label={c.label} valor={c.valor} ajuda={c.ajuda} fmtBRL={fmtBRL} />
      ))}
      <div className="border-t border-dashed border-gray-200 pt-1.5">
        <Linha label="Custos diretos" valor={m.custosDiretos} fmtBRL={fmtBRL} forte />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-2 py-1.5">
        <span className="flex items-center gap-1">
          ÷ {String(m.denom).replace(".", ",")}
          <Ajuda texto={`Divide pelo que sobra do preço depois das taxas e da margem: 1 − comissão (${pct(m.partes.comissao)}) − reserva (${pct(m.partes.reserva)}) − margem mínima (${pct(m.partes.margem)}).`} />
        </span>
        <span className="text-right">
          1 − {pct(m.partes.comissao)} − {pct(m.partes.reserva)} − {pct(m.partes.margem)}
        </span>
      </div>
      {m.inviavel ? (
        <p className="text-[11px] text-red-600">As taxas + margem somam ≥ 100% do preço — não há piso possível neste canal/destino.</p>
      ) : (
        <Linha op="=" label="Piso (preço mínimo)" valor={m.resultado} fmtBRL={fmtBRL} forte cor="text-red-600" />
      )}
    </Bloco>
  );
}

// Como chegamos no RECOMENDADO (quanto o mercado paga): referência × condição × embalagem × risco.
export function MemoriaTeto({ memoria, fmtBRL }) {
  const passos = memoria.teto;
  const resultado = passos[passos.length - 1]?.valor ?? 0;
  return (
    <Bloco resumo={<>Recomendado — por quê? <Ajuda termo="recomendado" /></>} resumoValor={resultado} fmtBRL={fmtBRL}>
      {passos.map((p, i) => (
        <Linha
          key={p.passo}
          op={i === 0 ? "" : "×"}
          label={p.fator != null ? `${p.passo} (×${String(p.fator).replace(".", ",")})` : p.passo}
          valor={p.valor}
          ajuda={p.ajuda}
          fmtBRL={fmtBRL}
          forte={i === passos.length - 1}
          cor={i === passos.length - 1 ? "text-orange-600" : null}
        />
      ))}
    </Bloco>
  );
}
