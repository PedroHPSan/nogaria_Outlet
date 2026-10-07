// Memória de cálculo do motor de preço v2: o "como chegamos a este preço" para o operador, em 4 blocos
// (mercado → custo do lote → custos e piso → para onde vai o preço) + resumo em texto.
import React from "react";
import { Bloco, Linha } from "./MemoriaCalculo";
import Ajuda from "./Ajuda";
import { decomporCustos, lucroEm, REGRAS } from "../../lib/motorPreco";

const pct1 = (f) => `${(Number(f) * 100).toFixed(1).replace(".", ",")}%`;
const pct0 = (f) => `${Math.round(Number(f) * 100)}%`;
const origemTxt = (o) => (o === "real" ? "real" : o === "estimado" ? "estimado" : o === "incluida" ? "já incluída no custo" : o);

function Origem({ o }) {
  if (!o) return null;
  const real = o === "real" || o === "incluida";
  return <span className={`ml-1 text-[10px] px-1.5 rounded-full ${real ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{origemTxt(o)}</span>;
}

/** r = resultado de analisarItens (com .memoria); preco = preço avaliado (digitado ou sugerido). */
export default function MemoriaCalculoV2({ r, preco, fmtBRL }) {
  const m = r.memoria;
  const p = Number(preco) > 0 ? Number(preco) : (r.sugerido ?? r.alvo);
  const custos = decomporCustos(p, r.canal);
  const eco = lucroEm(p, r.base, r.canal);
  const lote = m.lote;
  const rt = m.rateio;
  const margemPct = pct0(REGRAS.margemMin);
  const somaPct = r.pctVar;

  return (
    <div className="space-y-2">
      {/* 1) Mercado */}
      <Bloco resumo={<>Mercado — quanto vale <Ajuda termo="recomendado" /></>} resumoValor={r.alvo} fmtBRL={fmtBRL}>
        {m.mercado.map((passo, i) => (
          <Linha key={passo.passo} op={i === 0 ? "" : "×"}
            label={passo.fator != null ? `${passo.passo} (×${String(passo.fator).replace(".", ",")})` : passo.passo}
            valor={passo.valor} ajuda={passo.ajuda} fmtBRL={fmtBRL}
            forte={i === m.mercado.length - 1} cor={i === m.mercado.length - 1 ? "text-orange-600" : null} />
        ))}
        <p className="text-[11px] text-gray-500">É quanto o mercado paga por este item nesta condição. O preço sugerido parte daqui.</p>
      </Bloco>

      {/* 2) Custo do lote */}
      <Bloco resumo={<>Custo do lote — quanto custou este item <Ajuda termo="rateio" /></>} resumoValor={r.custoAloc} fmtBRL={fmtBRL}>
        {lote ? (
          <>
            {lote.lance != null ? (
              <>
                <Linha label="Lance do lote" valor={lote.lance} fmtBRL={fmtBRL} />
                <Linha op="+" label="Comissão do leiloeiro (5%)" valor={lote.comissao} fmtBRL={fmtBRL} />
                <Linha op="+" label={<>Taxa HISA <Origem o={lote.taxaOrigem} /></>} valor={lote.taxaHisa} ajuda="Taxa da HISA além do lance e da comissão." fmtBRL={fmtBRL} />
              </>
            ) : (
              <Linha label="Valor pago pelo lote (cadastro)" valor={lote.total - lote.frete} fmtBRL={fmtBRL} />
            )}
            <Linha op="+" label={<>Frete de aquisição <Origem o={lote.freteOrigem} /></>} valor={lote.frete} ajuda="Frete de buscar e transferir o lote. Enquanto não houver o valor real, usamos a estimativa de R$ 8 mil rateada pelo lance." fmtBRL={fmtBRL} />
            <div className="border-t border-dashed border-gray-200 pt-1.5">
              <Linha op="=" label="Custo total do lote" valor={lote.total} fmtBRL={fmtBRL} forte />
            </div>
          </>
        ) : (
          <p className="text-[11px] text-amber-700">Lote sem custo cadastrado: o piso não inclui custo de aquisição.</p>
        )}
        {rt && lote && (
          <div className="rounded-lg bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600 space-y-0.5">
            <p>
              Este item carrega <b>{pct1(rt.w)}</b> do lote ({m.nItens} itens): contribuição líquida de {fmtBRL(rt.contrib)} × peso {String(rt.k).replace(".", ",")}
              {rt.refEstimada ? " · referência ESTIMADA (baixa confiança)" : ""}{m.loteFechado ? " · rateio fechado (congelado)" : ""}.
            </p>
            <p>A contribuição líquida é o que o item devolve ao caixa depois de perda esperada, taxas e embalagem — por isso itens baratos não carregam custo que não conseguem pagar.</p>
          </div>
        )}
        <Linha op="=" label="Custo alocado a este item" valor={r.custoAloc} fmtBRL={fmtBRL} forte />
        <Linha op="+" label={`Embalagem (porte ${m.porte})`} valor={r.embalagem} ajuda="Custo de embalagem por porte: P R$ 2, M R$ 5, G R$ 12, GG R$ 20." fmtBRL={fmtBRL} />
        <Linha op="=" label="Custo de aquisição + embalagem" valor={r.base} fmtBRL={fmtBRL} forte cor="text-orange-600" />
      </Bloco>

      {/* 3) Custos e piso */}
      <Bloco resumo={<>Custos e piso — preço mínimo <Ajuda termo="piso" /></>} resumoValor={r.piso} fmtBRL={fmtBRL}>
        <p className="text-[11px] text-gray-500">Calculado em {fmtBRL(p)} no canal {r.canal}. Cada custo é um percentual do preço de venda:</p>
        {custos.linhas.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-2 text-xs text-gray-600">
            <span className="flex items-center gap-1 min-w-0"><span className="text-gray-400 w-3">−</span><span className="truncate">{l.label}</span>
              {l.id === "imposto" && <Ajuda termo="imposto" />}{l.id === "reserva" && <Ajuda termo="reserva" />}{l.id === "frete" && <Ajuda termo="frete" />}
            </span>
            <span className="flex-shrink-0 tabular-nums text-gray-700">{pct1(l.pct)} · {fmtBRL(l.valor)}</span>
          </div>
        ))}
        {custos.fixo > 0 && <Linha op="−" label="Tarifa fixa por item do canal" valor={custos.fixo} fmtBRL={fmtBRL} />}
        <div className="flex items-center justify-between text-[11px] text-gray-500 bg-gray-50 rounded-lg px-2 py-1.5">
          <span>Soma dos custos percentuais</span><span className="tabular-nums">{pct1(somaPct)} do preço</span>
        </div>
        <div className="text-[11px] text-gray-600 bg-gray-50 rounded-lg px-2 py-1.5 space-y-0.5">
          <p><b>Piso</b> (lucro zero) = (custo + embalagem{custos.fixo > 0 ? " + tarifa fixa" : ""}) ÷ (1 − {pct1(somaPct)}) = <b>{fmtBRL(r.piso)}</b></p>
          <p><b>Mínimo</b> ({margemPct} de margem <Ajuda termo="minimo" />) = (custo + embalagem{custos.fixo > 0 ? " + tarifa fixa" : ""}) ÷ (1 − {pct1(somaPct)} − {margemPct}) = <b>{fmtBRL(r.minimo)}</b></p>
        </div>
        {!Number.isFinite(r.minimo) && <p className="text-[11px] text-red-600">Taxas + margem somam 100% ou mais do preço: não há preço mínimo possível neste canal.</p>}
      </Bloco>

      {/* 4) Para onde vai o preço */}
      <Bloco resumo={<>Para onde vai o preço <Ajuda termo="lucro" /></>} resumoValor={eco.lucro} fmtBRL={fmtBRL}>
        <Linha label={`Receita (preço de ${fmtBRL(p)})`} valor={p} fmtBRL={fmtBRL} forte />
        <Linha op="−" label="Custo alocado do item" valor={r.custoAloc} fmtBRL={fmtBRL} />
        <Linha op="−" label="Embalagem" valor={r.embalagem} fmtBRL={fmtBRL} />
        {custos.linhas.map((l) => <Linha key={l.id} op="−" label={`${l.label} (${pct1(l.pct)})`} valor={l.valor} fmtBRL={fmtBRL} />)}
        {custos.fixo > 0 && <Linha op="−" label="Tarifa fixa do canal" valor={custos.fixo} fmtBRL={fmtBRL} />}
        <div className="border-t border-dashed border-gray-200 pt-1.5">
          <Linha op="=" label={`Lucro (${pct1(eco.margem)} do preço)`} valor={eco.lucro} fmtBRL={fmtBRL} forte cor={eco.lucro >= 0 ? "text-emerald-600" : "text-red-600"} />
        </div>
      </Bloco>

      {/* Resumo em texto */}
      <details className="rounded-xl border border-gray-100">
        <summary className="cursor-pointer list-none px-2.5 py-2 text-[11px] font-semibold uppercase text-gray-500">Resumo em texto — de onde chegamos a este preço</summary>
        <ul className="px-2.5 pb-2.5 space-y-1 text-xs text-gray-700 list-disc pl-6">{r.explicacao.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </details>
    </div>
  );
}
