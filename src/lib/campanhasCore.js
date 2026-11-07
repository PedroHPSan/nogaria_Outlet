// Regras puras das campanhas de promoção (sem rede). A regra de preço em si vive no SQL
// (precos_efetivos / campanha_resolver): aqui só validação de formulário, estado, horário de Brasília
// e agregados da simulação. Spec: docs/superpowers/specs/2026-11-07-campanhas-promocao-design.md

export const TIPOS_REGRA = [
  ["geral", "Todos os itens"], ["macro", "Macro-categoria"], ["grupo", "Categoria"],
  ["lote", "Lote"], ["estado", "Condição"], ["item", "Item (SKU)"],
];
export const ARREDONDAMENTOS = [["centavos", "Centavos"], ["inteiro", "Inteiro"], ["vitrine_90", "Final ,90"]];
export const CENARIOS_VENDA = [25, 50, 100];
const r2 = (n) => Math.round(n * 100) / 100;

// Brasília é UTC-3 fixo (sem horário de verão). O formulário usa "YYYY-MM-DDTHH:mm" no horário de Brasília.
export const brasiliaParaIso = (local) => (local ? new Date(`${local}:00-03:00`).toISOString() : null);
export const isoParaBrasilia = (iso) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 16) : "");

export const regraVazia = () => ({ tipo: "geral", alvo: "", canal: "", desconto_pct: "" });

// Devolve a lista de problemas (vazia = ok). `form` = { nome, inicio, fim } (datas locais de Brasília).
export function validarCampanha(form, regras, agora = new Date()) {
  const e = [];
  if (String(form?.nome || "").trim().length < 3) e.push("Dê um nome de pelo menos 3 letras.");
  if (String(form?.nome || "").trim().length > 80) e.push("Nome com no máximo 80 letras.");
  const ini = brasiliaParaIso(form?.inicio), fim = brasiliaParaIso(form?.fim);
  if (!ini || !fim) e.push("Informe início e fim.");
  else {
    if (new Date(fim) <= new Date(ini)) e.push("O fim precisa ser depois do início.");
    else if (new Date(fim) <= agora) e.push("O fim já passou.");
  }
  if (!regras?.length) e.push("Adicione ao menos uma regra de desconto.");
  const vistas = new Set();
  (regras || []).forEach((r, i) => {
    const n = i + 1, pct = Number(r.desconto_pct);
    if (r.desconto_pct === "" || r.desconto_pct == null || !Number.isFinite(pct)) e.push(`Regra ${n}: informe o desconto.`);
    else if (pct < 0 || pct > 90) e.push(`Regra ${n}: desconto entre 0% e 90%.`);
    if (r.tipo !== "geral" && !String(r.alvo || "").trim()) e.push(`Regra ${n}: escolha o alvo.`);
    const chave = `${r.tipo}|${r.tipo === "geral" ? "" : String(r.alvo || "").trim()}|${r.canal || ""}`;
    if (vistas.has(chave)) e.push(`Regra ${n}: repetida (mesmo alvo e canal).`);
    vistas.add(chave);
  });
  return e;
}

// Estado exibido (derivado de status + prazos; o servidor decide a vigência de verdade).
export function statusCampanha(c, agora = new Date()) {
  if (c.status === "CANCELADA") return "cancelada";
  if (c.status === "RASCUNHO") return "rascunho";
  if (new Date(c.inicio_em) > agora) return "agendada";
  if (new Date(c.fim_em) > agora) return "ativa";
  return "encerrada";
}
export const ROTULO_STATUS = { rascunho: "Rascunho", agendada: "Agendada", ativa: "Ativa", encerrada: "Encerrada", cancelada: "Cancelada" };

export function rotuloRegra(r, nomes = {}) {
  const base = r.tipo === "geral" ? "Todos os itens" : `${(TIPOS_REGRA.find((t) => t[0] === r.tipo) || [r.tipo, r.tipo])[1]}: ${nomes[r.alvo] || r.alvo}`;
  const pct = Number(r.desconto_pct) === 0 ? "fora da campanha" : `${Number(r.desconto_pct)}% off`;
  return `${base}${r.canal ? ` · só ${nomes[r.canal] || r.canal}` : ""} → ${pct}`;
}

// Formata "2d 04:13:22" a partir de milissegundos restantes (0 ou menos = "encerrada").
export function contagem(ms) {
  if (!(ms > 0)) return "encerrada";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400);
  const hms = [Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
  return d > 0 ? `${d}d ${hms}` : hms;
}

// Interpreta o erro de publicar: CONFLITO_SKU traz em `details` o JSON [{sku, campanha, campanha_id}].
export function conflitosDoErro(err) {
  if (!err || !/CONFLITO_SKU/.test(String(err.message || ""))) return null;
  try {
    const arr = JSON.parse(err.details || err.detail || "[]");
    const porCampanha = new Map();
    for (const c of arr) {
      const k = c.campanha_id || c.campanha;
      if (!porCampanha.has(k)) porCampanha.set(k, { campanha: c.campanha, skus: new Set() });
      porCampanha.get(k).skus.add(c.sku);
    }
    return [...porCampanha.values()].map((x) => ({ campanha: x.campanha, skus: [...x.skus] }));
  } catch { return []; }
}

/**
 * Agregados da simulação. `linhas` = linhas de campanha_simular (+ opcional `margem` por sku:
 * { antes, depois, semCusto } em R$ de lucro). Só conta item com desconto > 0 como "coberto".
 */
export function resumoSimulacao(linhas, margens = new Map()) {
  const cobertas = (linhas || []).filter((l) => Number(l.desconto_pct) > 0);
  const cheio = r2(cobertas.reduce((s, l) => s + Number(l.preco_cheio), 0));
  const promo = r2(cobertas.reduce((s, l) => s + Number(l.preco), 0));
  const desconto = r2(cheio - promo);
  const porRegra = {};
  for (const l of cobertas) porRegra[l.regra_tipo] = (porRegra[l.regra_tipo] || 0) + 1;
  let lucroAntes = 0, lucroDepois = 0, comCusto = 0, semCusto = 0;
  const abaixoPiso = [];
  for (const l of cobertas) {
    const m = margens.get(l.sku);
    if (!m || m.semCusto) { semCusto++; continue; }
    comCusto++;
    lucroAntes += m.antes; lucroDepois += m.depois;
    if (m.depois < 0) abaixoPiso.push(l.sku);
  }
  return {
    itens: cobertas.length, excluidos: (linhas || []).length - cobertas.length,
    cheio, promo, desconto, descontoMedioPct: cheio > 0 ? r2((desconto / cheio) * 100) : 0,
    porRegra, comCusto, semCusto, lucroAntes: r2(lucroAntes), lucroDepois: r2(lucroDepois), abaixoPiso,
    conflitos: cobertas.filter((l) => l.conflito_campanha).length,
    cenarios: CENARIOS_VENDA.map((p) => ({ pct: p, receita: r2((promo * p) / 100), descontoDado: r2((desconto * p) / 100) })),
  };
}

// ---- Página pública (/promo/<slug>): o servidor manda `agora`; o relógio do cliente só interpola. ----
export const offsetServidor = (agoraIso, clienteMs = Date.now()) => Date.parse(agoraIso) - clienteMs;
export const msAte = (alvoIso, offset = 0, clienteMs = Date.now()) => Date.parse(alvoIso) - (clienteMs + offset);

// Fase exibida com o relógio ajustado ao do servidor. Vira "encerrada" no zero; a página confirma com nova consulta.
export function faseCampanha(d, offset = 0, clienteMs = Date.now()) {
  if (msAte(d.inicio_em, offset, clienteMs) > 0) return "agendada";
  if (msAte(d.fim_em, offset, clienteMs) > 0) return "ativa";
  return "encerrada";
}

const fmtBrl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtPrazo = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
};

// Mensagem do "Quero este": leva o preço promocional e até quando vale.
export function mensagemQuero(item, camp, url) {
  const promo = Number(item.preco_cheio) > Number(item.preco) ? ` por ${fmtBrl(item.preco)} (de ${fmtBrl(item.preco_cheio)})` : item.preco > 0 ? ` — ${fmtBrl(item.preco)}` : "";
  return `Olá! Quero ${item.produto} (${item.sku})${promo} da campanha "${camp.nome}", oferta até ${fmtPrazo(camp.fim_em)}.${url ? ` ${url}` : ""}`;
}

// Sobrepõe a promoção vigente (vinda do servidor) ao item de uma página já existente (/i, /p).
// Só aplica se a promo realmente baixa o preço; o resto do item fica como está.
export function aplicarPromo(item, promo) {
  if (!promo || !(Number(promo.preco) > 0) || !(Number(promo.preco_cheio) > Number(promo.preco))) return item;
  return { ...item, preco: Number(promo.preco), preco_cheio: Number(promo.preco_cheio), desconto_pct: Number(promo.desconto_pct) };
}

// Entre várias promoções vigentes (itens de campanhas diferentes), a que termina primeiro manda na contagem.
export function promoQueTerminaPrimeiro(promos) {
  const v = Object.values(promos || {}).filter((p) => p?.fim_em);
  return v.length ? v.reduce((a, b) => (Date.parse(b.fim_em) < Date.parse(a.fim_em) ? b : a)) : null;
}

// ---- Sacola (equipe): item que entra durante a campanha leva o preço promocional no snapshot ----
// `pe` = linha de precos_efetivos (preco, preco_cheio, campanha_id, campanha_nome, campanha_fim). Sem campanha → item intacto.
export function aplicarPromoSacola(snap, pe, entrouEm = new Date().toISOString()) {
  if (!pe?.campanha_id || !(Number(pe.preco) > 0) || !(Number(pe.preco_cheio) > Number(pe.preco))) return snap;
  return {
    ...snap, preco: Number(pe.preco), preco_cheio: Number(pe.preco_cheio), preco_promo: Number(pe.preco),
    campanha_id: pe.campanha_id, campanha_nome: pe.campanha_nome || "", campanha_fim: pe.campanha_fim, entrou_em: entrouEm,
  };
}

// Promo do snapshot que já passou do fim e ainda não teve decisão (o banco é quem confirma, no pagamento).
export const promoVencida = (item, agora = new Date()) =>
  !!item?.campanha_id && !item.campanha_decisao && !!item.campanha_fim && new Date(item.campanha_fim) <= new Date(agora);

// DECISAO_CAMPANHA: o `details` do erro traz [{sku, produto, preco_promo, preco_cheio_atual, campanha, campanha_fim}].
export function pendentesDoErro(err) {
  if (!err || !/DECISAO_CAMPANHA/.test(String(err.message || ""))) return null;
  try { const a = JSON.parse(err.details || err.detail || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}
