// Sacola do cliente no WhatsApp (PURO): casar cliente, somar item, resumo de cobrança.
// Sem rede — importável em testes Node.
import { snapshotItens, totais, statusEfetivo } from "./orcamentosCore.js";
import { aplicarPromoSacola } from "./campanhasCore.js";

export const FORMAS_PAGAMENTO = ["Pix", "Dinheiro", "Débito", "Crédito", "Transferência", "Outro"];
export const FORMAS_COM_TAXA = ["Débito", "Crédito"];

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ── Financeiro da sacola ──────────────────────────────────────────────────────────────────────────────
// `s.pagamentos` (linhas de orcamento_pagamentos, anexadas por listarSacolas) é a fonte; sem elas vale o valor_pago.
export const pagamentosAtivos = (s) => (s?.pagamentos || []).filter((p) => !p.estornado_em);
export const valorRecebido = (s) => (s?.pagamentos ? r2(pagamentosAtivos(s).reduce((a, p) => a + (Number(p.valor) || 0), 0)) : r2(Number(s?.valor_pago) || 0));

// Total, recebido, saldo e situação (NAO_PAGO | PARCIAL | QUITADO). O saldo só conta como "a receber" na ABERTA ou
// quando um gestor liberou a venda com saldo em aberto (fiado); sacola antiga paga por fora do sistema não vira dívida.
export function financeiroDaSacola(s, agora = new Date()) {
  const total = totais(s.itens, s.desconto_pct).total;
  const pago = valorRecebido(s);
  const saldo = Math.max(0, r2(total - pago));
  const ef = statusEfetivo(s, agora);
  const devendo = saldo > 0.004 && (ef === "ABERTA" || !!s.liberada_com_saldo_em);
  return { total, pago, saldo, devendo, situacao: pago <= 0 ? "NAO_PAGO" : saldo > 0.004 ? "PARCIAL" : "QUITADO" };
}

export const taxaLiquida = (valor, taxaPct) => r2(Number(valor) * (1 - (Number(taxaPct) || 0) / 100));

const diaISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Parcelas combinadas (crediário): o que já foi recebido abate da mais antiga para a mais nova.
export function situacaoParcelas(parcelas, recebido, hoje = new Date()) {
  let resto = r2(recebido); const d0 = diaISO(new Date(hoje));
  return [...(parcelas || [])].sort((a, b) => a.numero - b.numero).map((p) => {
    const v = r2(p.valor); const pago = r2(Math.min(v, Math.max(0, resto))); resto = r2(resto - pago);
    const aberto = r2(v - pago);
    const estado = aberto <= 0.004 ? "PAGA" : String(p.vencimento) < d0 ? "VENCIDA" : pago > 0 ? "PARCIAL" : "ABERTA";
    return { ...p, pago, aberto, estado };
  });
}
export const proximaParcela = (sit) => (sit || []).find((p) => p.aberto > 0.004) || null;

// Plano sugerido: o que já foi pago entra como 1ª parcela (hoje) e o saldo se divide em `n` vezes. `intervalo` em dias
// ou "mes" (mesmo dia dos meses seguintes). Centavos que sobram vão para a primeira das novas parcelas.
export function gerarPlano({ saldo, n, primeiroVencimento, intervalo = 30, pago = 0, hoje = new Date() }) {
  const k = Math.max(1, Math.min(24, Math.floor(Number(n) || 1)));
  const cents = Math.round(r2(saldo) * 100); const base = Math.floor(cents / k); const sobra = cents - base * k;
  const [a, m, d] = String(primeiroVencimento).split("-").map(Number);
  const venc = (i) => {
    if (intervalo === "mes") { const t = new Date(Date.UTC(a, m - 1 + i, 1)); const ult = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d, ult)); return t.toISOString().slice(0, 10); }
    return new Date(Date.UTC(a, m - 1, d + i * Number(intervalo))).toISOString().slice(0, 10);
  };
  const plano = [];
  if (r2(pago) > 0) plano.push({ valor: r2(pago), vencimento: diaISO(new Date(hoje)) });
  for (let i = 0; i < k; i++) plano.push({ valor: (base + (i === 0 ? sobra : 0)) / 100, vencimento: venc(i) });
  return plano.filter((p) => p.valor > 0);
}

export const soDigitos = (s) => String(s || "").replace(/\D/g, "");
const norm = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Mesma pessoa: WhatsApp igual (se ambos tiverem) ou, sem WhatsApp, nome igual.
export function mesmoCliente(sacola, { nome, whatsapp }) {
  const a = soDigitos(sacola.cliente_whatsapp), b = soDigitos(whatsapp);
  if (a && b) return a === b;
  return !!norm(nome) && norm(sacola.cliente_nome) === norm(nome);
}

export const sacolaAbertaDe = (sacolas, cliente, agora = new Date()) =>
  (sacolas || []).find((s) => s.origem === "whatsapp" && statusEfetivo(s, agora) === "ABERTA" && mesmoCliente(s, cliente)) || null;

// Acrescenta o item ao snapshot da sacola (idempotente por SKU). Recusa item sem preço de venda.
// `promo` (linha de precos_efetivos) leva o preço da campanha vigente para o snapshot, com o "de" congelado.
export function adicionarItem(itensSacola, item, promo = null, entrouEm) {
  const [base] = snapshotItens([item]);
  const snap = aplicarPromoSacola(base, promo, entrouEm);
  if (!(Number(snap.preco) > 0)) throw new Error(`${item.sku}: sem preço de venda — defina o preço antes de separar.`);
  if ((itensSacola || []).some((i) => i.sku === snap.sku)) return itensSacola;
  return [...(itensSacola || []), snap];
}

export const removerItem = (itensSacola, sku) => (itensSacola || []).filter((i) => i.sku !== sku);

// Resumo do que falta receber/entregar. `agora` torna o vencimento testável.
export function resumoSacolas(sacolas, agora = new Date()) {
  const r = { abertas: 0, aReceber: 0, vencendo: 0, pagasSemEntrega: 0, recebido: 0, vencido: 0 };
  for (const s of sacolas || []) {
    if (s.origem !== "whatsapp") continue;
    const st = statusEfetivo(s, agora);
    const f = financeiroDaSacola(s, agora);
    if (st === "ABERTA") {
      r.abertas++;
      r.aReceber += f.saldo; r.recebido += f.pago;
      if (f.pago <= 0 && new Date(s.validade) - new Date(agora) < 86400000) r.vencendo++;
    } else if (st === "VENDIDO" || st === "ENTREGUE") {
      if (st === "VENDIDO") r.pagasSemEntrega++;
      r.recebido += f.pago;
      if (f.devendo) r.aReceber += f.saldo;
    }
    if (f.devendo) for (const p of situacaoParcelas(s.parcelas, f.pago, agora)) if (p.estado === "VENCIDA") r.vencido += p.aberto;
  }
  r.aReceber = r2(r.aReceber); r.recebido = r2(r.recebido); r.vencido = r2(r.vencido);
  return r;
}

const brl = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 })}`;

// Lembrete de pagamento que o vendedor manda ao cliente.
export function mensagemCobranca(sacola) {
  const t = totais(sacola.itens, sacola.desconto_pct);
  const f = financeiroDaSacola(sacola);
  const prox = f.pago > 0 ? proximaParcela(situacaoParcelas(sacola.parcelas, f.pago)) : null;
  const linhas = (sacola.itens || []).map((i) => `• ${i.produto} (${i.sku}) — ${Number(i.preco_cheio) > Number(i.preco) ? `de ${brl(i.preco_cheio)} por ${brl(i.preco)}` : brl(i.preco)}`);
  const ate = sacola.validade ? new Date(sacola.validade).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : null;
  return [
    `Olá${sacola.cliente_nome ? `, ${sacola.cliente_nome}` : ""}! Separei para você:`,
    ...linhas,
    f.pago > 0 ? `Total ${brl(t.total)} · já recebi ${brl(f.pago)} · *falta ${brl(f.saldo)}*` : `*Total: ${brl(t.total)}*`,
    prox ? `Próxima parcela: ${brl(prox.aberto)} em ${prox.vencimento.split("-").reverse().slice(0, 2).join("/")}.` : null,
    f.pago > 0 ? "Me avisa quando fizer o próximo pagamento!" : ate ? `Seguro até ${ate}. Me avisa quando fizer o pagamento!` : "Me avisa quando fizer o pagamento!",
  ].filter((l) => l != null).join("\n");
}

// Totais da sacola com a decisão pós-campanha: `promo` mantém os preços; `cheio` troca os itens pendentes pelo preço cheio ATUAL.
export function totaisComDecisao(itens, descontoPct, pendentes) {
  const atual = new Map((pendentes || []).map((p) => [p.sku, Number(p.preco_cheio_atual)]));
  const promo = totais(itens, descontoPct).total;
  const cheio = totais((itens || []).map((i) => (atual.has(i.sku) ? { ...i, preco: atual.get(i.sku) } : i)), descontoPct).total;
  return { promo, cheio, diferenca: Math.round((cheio - promo) * 100) / 100 };
}

export const linkCobranca = (sacola) => {
  const n = soDigitos(sacola.cliente_whatsapp);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(mensagemCobranca(sacola))}` : null;
};

const mesmoDia = (iso, agora) => !!iso && new Date(iso).toDateString() === new Date(agora).toDateString();

// Painel do dia: o que foi separado, recebido e entregue hoje.
export function resumoDoDia(sacolas, agora = new Date()) {
  const r = { separadas: { n: 0, valor: 0 }, pagas: { n: 0, valor: 0 }, entregues: 0 };
  for (const s of sacolas || []) {
    if (s.origem !== "whatsapp") continue;
    if (mesmoDia(s.criado_em, agora)) { r.separadas.n++; r.separadas.valor += totais(s.itens, s.desconto_pct).total; }
    if (mesmoDia(s.pago_em, agora)) { r.pagas.n++; r.pagas.valor += Number(s.valor_pago) || 0; }
    if (mesmoDia(s.entregue_em, agora)) r.entregues++;
  }
  return r;
}

// Recebimentos do dia (fluxo de caixa): pagamentos ativos com recebido_em hoje, por forma, com o líquido do cartão.
export function recebimentosDoDia(sacolas, agora = new Date()) {
  const r = { n: 0, total: 0, liquido: 0, porForma: {} };
  for (const s of sacolas || []) {
    if (s.origem !== "whatsapp") continue;
    for (const p of pagamentosAtivos(s)) {
      if (!mesmoDia(p.recebido_em, agora)) continue;
      const v = Number(p.valor) || 0; const l = Number(p.valor_liquido ?? p.valor) || 0;
      r.n++; r.total += v; r.liquido += l; r.porForma[p.forma] = (r.porForma[p.forma] || 0) + v;
    }
  }
  r.total = r2(r.total); r.liquido = r2(r.liquido);
  for (const k of Object.keys(r.porForma)) r.porForma[k] = r2(r.porForma[k]);
  return r;
}

// Relatório por cliente (ignora sacolas canceladas/vencidas): quanto já pagou, quanto deve, o que falta entregar.
export function porCliente(sacolas, agora = new Date()) {
  const mapa = new Map();
  for (const s of sacolas || []) {
    if (s.origem !== "whatsapp") continue;
    const st = statusEfetivo(s, agora);
    if (!["ABERTA", "VENDIDO", "ENTREGUE"].includes(st)) continue;
    const chave = soDigitos(s.cliente_whatsapp) || `n:${norm(s.cliente_nome)}`;
    const c = mapa.get(chave) || { nome: s.cliente_nome || null, whatsapp: soDigitos(s.cliente_whatsapp) || null, sacolas: 0, aPagar: 0, pago: 0, aEntregar: 0 };
    c.sacolas++;
    if (!c.nome && s.cliente_nome) c.nome = s.cliente_nome;
    const f = financeiroDaSacola(s, agora);
    if (st === "ABERTA") { c.aPagar += f.saldo; c.pago += f.pago; }
    else { c.pago += f.pago; if (f.devendo) c.aPagar += f.saldo; if (st === "VENDIDO") c.aEntregar++; }
    mapa.set(chave, c);
  }
  return [...mapa.values()].sort((a, b) => (b.pago + b.aPagar) - (a.pago + a.aPagar));
}

// Reabrir sacola vencida / estender o prazo: opções em dias a partir de AGORA (o prazo antigo não é somado).
export const PRAZOS_RENOVACAO = [1, 3, 7, 15, 30];
export const rotuloPrazo = (dias) => (dias === 1 ? "1 dia" : `${dias} dias`);
