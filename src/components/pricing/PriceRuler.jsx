import React from "react";

// Régua de preço: mostra de relance se o preço digitado é seguro.
//  🔴 0→piso = prejuízo · 🟢 piso→mercado = lucro saudável · ⬜ >mercado = difícil vender.
// Quando inviável (piso > mercado), a faixa de lucro fica fora do alcance do mercado.
export default function PriceRuler({ piso = 0, recomendado = 0, preco, fmtBRL }) {
  const p = Number(preco) > 0 ? Number(preco) : null;
  const viavel = recomendado > 0 && piso > 0 && recomendado >= piso;
  const max = (Math.max(piso, recomendado, p || 0) || 1) * 1.18;
  const pct = (x) => Math.min(100, Math.max(0, (x / max) * 100));

  const pPiso = pct(piso);
  const pRec = pct(recomendado);
  const abaixoPiso = p != null && piso > 0 && p < piso;

  // Segmentos coloridos do trilho.
  const segs = viavel
    ? [
        { left: 0, width: pPiso, cls: "bg-red-400" },
        { left: pPiso, width: Math.max(0, pRec - pPiso), cls: "bg-emerald-400" },
        { left: pRec, width: Math.max(0, 100 - pRec), cls: "bg-gray-200" },
      ]
    : [
        { left: 0, width: pPiso, cls: "bg-red-400" },
        { left: pPiso, width: Math.max(0, 100 - pPiso), cls: "bg-emerald-200" },
      ];

  // Marcadores de referência (piso e mercado) abaixo do trilho.
  const ticks = [
    { at: pPiso, label: "Piso", valor: piso, cor: "text-red-600" },
    { at: pRec, label: "Mercado", valor: recomendado, cor: "text-gray-600" },
  ];

  return (
    <div className="pt-1.5 pb-6">
      <div className="relative h-3 rounded-full overflow-hidden bg-gray-100">
        {segs.map((s, i) => (
          <div key={i} className={`absolute top-0 h-full ${s.cls}`}
            style={{ left: `${s.left}%`, width: `${s.width}%` }} />
        ))}
        {/* Marcador do preço digitado */}
        {p != null && (
          <div className="absolute -top-1 h-5 w-1 rounded-full bg-gray-900 shadow"
            style={{ left: `calc(${pct(p)}% - 2px)` }} aria-hidden />
        )}
      </div>

      {/* Ticks de piso/mercado */}
      <div className="relative h-0">
        {ticks.filter((t) => t.valor > 0).map((t, i) => (
          <div key={i} className="absolute top-1 -translate-x-1/2 flex flex-col items-center"
            style={{ left: `${t.at}%` }}>
            <span className="w-px h-1.5 bg-gray-300" />
            <span className={`text-[10px] font-semibold leading-tight ${t.cor}`}>{t.label}</span>
            <span className="text-[10px] text-gray-500 leading-tight">{fmtBRL(t.valor)}</span>
          </div>
        ))}
      </div>

      <p className="sr-only">
        {abaixoPiso
          ? `Preço ${fmtBRL(p)} abaixo do piso ${fmtBRL(piso)}: prejuízo.`
          : viavel
            ? `Faixa de lucro entre piso ${fmtBRL(piso)} e mercado ${fmtBRL(recomendado)}.`
            : `Inviável: piso ${fmtBRL(piso)} acima do que o mercado paga ${fmtBRL(recomendado)}.`}
      </p>
    </div>
  );
}
