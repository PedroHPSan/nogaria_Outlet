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

// ---- Resultado ----
export const ROTULO_DECISAO = {
  no_prazo: "Vendido no prazo", manteve_promo: "Fechado depois do fim · manteve a promoção",
  preco_cheio: "Fechado depois do fim · cobrado a preço cheio", sem_decisao: "Fechado depois do fim · sem decisão registrada",
};
const g = (r, k) => r?.por_decisao?.[k] || { itens: 0, receita: 0, desconto: 0 };
// Números do painel: vendidos, receita, desconto concedido (tudo que saiu com preço abaixo do "de") e conversão sobre os itens da campanha.
export function resumoResultado(r) {
  if (!r) return null;
  const decisoes = ["no_prazo", "manteve_promo", "preco_cheio", "sem_decisao"].map((k) => ({ k, ...g(r, k) }));
  const vendidos = decisoes.reduce((s, d) => s + Number(d.itens), 0);
  const receita = r2(decisoes.reduce((s, d) => s + Number(d.receita), 0));
  const desconto = r2(decisoes.reduce((s, d) => s + Number(d.desconto), 0));
  const total = Number(r.itens_na_campanha) || 0;
  return {
    decisoes, vendidos, receita, desconto, total,
    conversaoPct: total > 0 ? r2((vendidos / total) * 100) : 0,
    depoisDoFim: ["manteve_promo", "preco_cheio", "sem_decisao"].reduce((s, k) => s + Number(g(r, k).itens), 0),
    comprometido: r2(Number(r.sacolas_abertas?.desconto_comprometido) || 0),
    sacolasAbertas: Number(r.sacolas_abertas?.sacolas) || 0, itensEmSacola: Number(r.sacolas_abertas?.itens) || 0,
    naoVendidos: Number(r.nao_vendidos) || 0, foraDaSacola: Number(r.fora_da_sacola?.itens) || 0, receitaFora: r2(Number(r.fora_da_sacola?.receita) || 0),
  };
}

// Aviso na ficha do item: campanhas publicadas e ainda não encerradas que cobrem o SKU com desconto.
export function avisoCampanhaItem(linhas, agora = new Date()) {
  const vig = (linhas || []).filter((l) => Number(l.desconto_pct) > 0 && l.campanhas?.status === "PUBLICADA" && new Date(l.campanhas.fim_em) > agora);
  if (!vig.length) return null;
  vig.sort((a, b) => new Date(a.campanhas.inicio_em) - new Date(b.campanhas.inicio_em));
  const l = vig[0];
  return { campanha: l.campanhas.nome, ativa: new Date(l.campanhas.inicio_em) <= agora, inicio_em: l.campanhas.inicio_em, fim_em: l.campanhas.fim_em, preco_cheio: Number(l.preco_cheio), desconto_pct: Number(l.desconto_pct) };
}

// ---- Divulgação no grupo do WhatsApp ----
export const linkCampanha = (slug, origem) => `${String(origem || "").replace(/\/+$/, "")}/promo/${slug}`;
export function textoGrupoCampanha(c, url, maxPct) {
  const pct = Number(maxPct) > 0 ? `Até ${String(Number(maxPct)).replace(".", ",")}% OFF · ` : "";
  return `🔥 *${c.nome}*\n${pct}válido até ${fmtPrazo(c.fim_em)}\nToque para ver as peças:\n${url}`;
}

// Item como o cliente deve ver AGORA (card, título e texto do grupo): preço da campanha + "de" congelado.
// `p` = linha de precos_efetivos com campanha; sem campanha o item volta intacto.
export const comPromo = (it, p) => (p ? { ...it, preco_ideal: p.preco, preco_cheio: p.preco_cheio, desconto_pct: p.desconto_pct, campanha_fim: p.campanha_fim ?? null, campanha_nome: p.campanha_nome ?? null } : it);

// Item em campanha (preço cheio congelado maior que o preço atual).
export const emPromo = (it) => Number(it?.preco_cheio) > 0 && Number(it?.preco_ideal) > 0 && Number(it.preco_cheio) > Number(it.preco_ideal);
export const pctPromo = (it) => (emPromo(it) ? Math.round((1 - Number(it.preco_ideal) / Number(it.preco_cheio)) * 100) : 0);
// Prazo mais próximo entre os itens em campanha ("15/11 às 23:59") ou null.
export function prazoPromo(itens) {
  const fins = (itens || []).filter((i) => emPromo(i) && i.campanha_fim).map((i) => i.campanha_fim).sort();
  return fins.length ? fmtPrazo(fins[0]) : null;
}

// ---- Auditoria dos produtos da campanha ----
export const SITUACOES = {
  na_campanha: ["Na campanha", "bg-emerald-100 text-emerald-800", "A peça recebe o desconto."],
  excluida_0pct: ["Excluída (0%)", "bg-gray-200 text-gray-600", "Uma regra com 0% tirou esta peça da campanha."],
  sem_preco: ["Sem preço", "bg-amber-100 text-amber-800", "A peça não tem preço de venda: defina o preço para ela entrar."],
  indisponivel: ["Vendida/descartada", "bg-gray-200 text-gray-600", "A peça já foi vendida, entregue ou descartada."],
  conflito: ["Em outra campanha", "bg-red-100 text-red-700", "Um produto só pode estar em uma campanha por vez no mesmo período."],
  nao_incluida: ["Não incluída", "bg-sky-100 text-sky-800", "Casa com as regras, mas a campanha publicada não a congelou: use Reaplicar regras ou Incluir."],
};
export const ORDEM_SITUACOES = ["na_campanha", "nao_incluida", "sem_preco", "conflito", "indisponivel", "excluida_0pct"];

export function resumoAuditoria(linhas) {
  const por = Object.fromEntries(ORDEM_SITUACOES.map((k) => [k, 0]));
  for (const l of linhas || []) por[l.situacao] = (por[l.situacao] || 0) + 1;
  const na = (linhas || []).filter((l) => l.situacao === "na_campanha");
  return { total: (linhas || []).length, por, naCampanha: por.na_campanha, foraDoCatalogo: na.filter((l) => !l.no_catalogo).length, manuais: na.filter((l) => l.origem === "manual").length };
}

export function filtrarAuditoria(linhas, { situacao = "", busca = "" } = {}) {
  const q = String(busca || "").trim().toLowerCase();
  return (linhas || []).filter((l) => (!situacao || l.situacao === situacao) && (!q || `${l.sku} ${l.produto || ""} ${l.grupo || ""}`.toLowerCase().includes(q)));
}

// SKUs colados (um por linha ou separados por vírgula/espaço/;). Maiúsculos, sem repetição, ignora lixo.
export function lerSkusColados(texto) {
  const tokens = String(texto || "").split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9][A-Z0-9-]{2,}$/.test(t));
  return [...new Set(tokens)];
}

export const ROTULO_LOG = { item_incluido: "Item incluído", item_removido: "Item removido", publicada: "Campanha publicada", cancelada: "Campanha cancelada", prazo_alterado: "Prazo/estado alterado" };
// Mensagem amigável para os erros de publicação (NENHUM_ITEM: …).
export const msgErroCampanha = (e) => String(e?.message || e || "").replace(/^NENHUM_ITEM:\s*/, "");

// Regras de item (rascunho): adiciona/atualiza a regra "item" de cada SKU com o desconto (0 = excluir da campanha).
export function comRegrasDeItem(regras, skus, pct) {
  const set = new Set(skus);
  const resto = (regras || []).filter((r) => !(r.tipo === "item" && set.has(String(r.alvo).toUpperCase()) && !r.canal));
  return [...resto, ...skus.map((s) => ({ tipo: "item", alvo: s, canal: "", desconto_pct: String(pct) }))];
}
export const semRegraDeItem = (regras, sku) => (regras || []).filter((r) => !(r.tipo === "item" && String(r.alvo).toUpperCase() === String(sku).toUpperCase() && !r.canal));

// ---- Publicar no catálogo as peças da campanha que ainda não estão lá ----
export const MOTIVO_CATALOGO = { etapa: "etapa do item ainda não permite", sem_foto: "sem foto", sem_preco: "sem preço", sem_estado: "sem condição (estado)", sem_categoria: "sem categoria", reservado: "reservado/separado", vendido: "vendido" };

/**
 * Decide o que publicar: só peças da campanha (situação na_campanha), ainda fora do catálogo e ELEGÍVEIS pela regra do catálogo
 * (`elegiveis` = { sku: { elegivel, motivos[] } }). As demais ficam com o motivo. Nunca mexe em peça fora da campanha.
 */
export function planejarPublicacaoCatalogo(linhasAuditoria, elegiveis) {
  const alvo = (linhasAuditoria || []).filter((l) => l.situacao === "na_campanha" && !l.no_catalogo);
  const publicar = [], ficam = [];
  for (const l of alvo) {
    const e = elegiveis?.[l.sku];
    if (e?.elegivel) publicar.push(l.sku);
    else ficam.push({ sku: l.sku, produto: l.produto, motivos: (e?.motivos?.length ? e.motivos : ["não avaliada"]).map((m) => MOTIVO_CATALOGO[m] || m) });
  }
  return { publicar, ficam, total: alvo.length };
}

// ---- Auditoria por produto (ficha do item): em quais campanhas ele está/esteve ----
// `linhas` = campanha_itens do SKU (+ campanhas(...)); `vendas` = campanha_vendas do SKU. Mais recente primeiro.
export function historicoDoProduto(linhas, vendas = [], agora = new Date()) {
  const vend = new Map((vendas || []).map((v) => [v.campanha_id, v]));
  const porCamp = new Map();
  for (const l of linhas || []) {
    if (!l.campanhas) continue;
    const k = l.campanha_id;
    const base = porCamp.get(k) || { campanha_id: k, nome: l.campanhas.nome, inicio_em: l.campanhas.inicio_em, fim_em: l.campanhas.fim_em, status: l.campanhas.status, canais: [], preco_cheio: Number(l.preco_cheio), desconto_pct: Number(l.desconto_pct), origem: l.regra_tipo === "manual" ? "manual" : "regra" };
    base.canais.push(`${l.canal === "*" ? "todos" : l.canal}:${Number(l.desconto_pct)}%`);
    if (Number(l.desconto_pct) > base.desconto_pct) base.desconto_pct = Number(l.desconto_pct);
    porCamp.set(k, base);
  }
  return [...porCamp.values()].map((c) => {
    const ini = new Date(c.inicio_em), fim = new Date(c.fim_em);
    const estado = c.status === "CANCELADA" ? "cancelada" : ini > agora ? "agendada" : fim > agora ? "ativa" : "encerrada";
    const v = vend.get(c.campanha_id) || null;
    return { ...c, estado, preco_promo: Math.round(c.preco_cheio * (1 - c.desconto_pct / 100) * 100) / 100, venda: v };
  }).sort((a, b) => new Date(b.inicio_em) - new Date(a.inicio_em));
}
