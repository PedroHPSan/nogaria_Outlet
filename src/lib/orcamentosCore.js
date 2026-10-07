// Orçamento persistido (PURO): status, transições, totais com desconto, validade,
// mensagem para o cliente. Sem rede — importável em testes Node.
import { precoVenda } from "./export.js";

export const STATUS_ORC = ["RASCUNHO", "ENVIADO", "RESERVADO", "VENDIDO", "CANCELADO", "EXPIRADO"];
export const HORAS_VALIDADE = 48;

const TRANSICOES = {
  RASCUNHO: ["ENVIADO", "RESERVADO", "CANCELADO"],
  ENVIADO: ["RESERVADO", "VENDIDO", "CANCELADO", "EXPIRADO"],
  RESERVADO: ["VENDIDO", "CANCELADO", "EXPIRADO"],
  VENDIDO: [], CANCELADO: [], EXPIRADO: [],
};
export const podeTransitar = (de, para) => (TRANSICOES[de] || []).includes(para);
export const terminal = (status) => (TRANSICOES[status] || []).length === 0;

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

export const codigoOrcamento = (seq) => `ORC-${String(seq).padStart(4, "0")}`;
export function proximoSeq(ultimoCodigo) {
  const m = String(ultimoCodigo || "").match(/(\d+)$/);
  return (m ? parseInt(m[1], 10) : 0) + 1;
}

export const validadeEm = (agora = new Date(), horas = HORAS_VALIDADE) =>
  new Date(new Date(agora).getTime() + horas * 3600000).toISOString();

// ENVIADO/RESERVADO vencidos passam a EXPIRADO só na leitura (sem job).
export function statusEfetivo(orc, agora = new Date()) {
  if (["ENVIADO", "RESERVADO"].includes(orc?.status) && orc.validade && new Date(orc.validade) < new Date(agora)) return "EXPIRADO";
  return orc?.status;
}

export const reservaAtiva = (item, agora = new Date()) =>
  !!item?.reservado_ate && new Date(item.reservado_ate) > new Date(agora);

// Snapshot do que o cliente viu: preço de venda congelado no momento do orçamento.
export const snapshotItens = (itens) =>
  (itens || []).map((it) => ({
    sku: it.sku, produto: it.produto || it.sku, marca: it.marca || "",
    preco: precoVenda(it) ?? null, estado: it.estado || "",
  }));

// Totais com desconto % global. Itens sem preço ficam fora do total ("sob consulta").
export function totais(itens, descontoPct = 0) {
  const pct = Math.min(90, Math.max(0, Number(descontoPct) || 0));
  const subtotal = r2((itens || []).reduce((s, i) => s + (Number(i.preco) > 0 ? Number(i.preco) : 0), 0));
  const desconto = r2(subtotal * (pct / 100));
  return { subtotal, desconto, total: r2(subtotal - desconto), pct, semPreco: (itens || []).filter((i) => !(Number(i.preco) > 0)).map((i) => i.sku) };
}

// Valor vendido por item (desconto proporcional); o último absorve o resíduo de
// centavos para a soma bater com o total do orçamento.
export function valoresPorItem(itens, descontoPct = 0) {
  const lista = (itens || []).filter((i) => Number(i.preco) > 0);
  const t = totais(itens, descontoPct);
  let acum = 0;
  return lista.map((i, idx) => {
    const v = idx === lista.length - 1 ? r2(t.total - acum) : r2(Number(i.preco) * (1 - t.pct / 100));
    acum = r2(acum + v);
    return { sku: i.sku, valor: v };
  });
}

// Itens cujo valor FINAL (já com o desconto do orçamento) fica abaixo do piso (custo + taxas).
// `pisos` = { sku: piso }. Sem piso conhecido para o sku, não acusa nada.
export function abaixoDoPiso(itens, descontoPct = 0, pisos = {}) {
  return valoresPorItem(itens, descontoPct)
    .filter((v) => Number(pisos[v.sku]) > 0 && v.valor < Number(pisos[v.sku]))
    .map((v) => ({ sku: v.sku, valor: v.valor, piso: Number(pisos[v.sku]) }));
}

const brl = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Texto para o vendedor mandar ao cliente (WhatsApp).
export function mensagemCliente(orc, link) {
  const t = totais(orc.itens, orc.desconto_pct);
  const linhas = (orc.itens || []).map((i) => `• ${i.produto} (${i.sku}) — ${Number(i.preco) > 0 ? brl(i.preco) : "sob consulta"}`);
  const cab = `Orçamento ${orc.codigo} — Nogária Outlet${orc.cliente_nome ? ` para ${orc.cliente_nome}` : ""}`;
  const rod = [
    t.pct ? `Desconto de ${t.pct}%: -${brl(t.desconto)}` : null,
    `*Total: ${brl(t.total)}*${t.semPreco.length ? " (+ itens sob consulta)" : ""}`,
    orc.validade ? `Válido até ${dataHora(orc.validade)}` : null,
    link ? `Veja e reserve: ${link}` : null,
  ].filter(Boolean);
  return [cab, "", ...linhas, "", ...rod].join("\n");
}

// Mensagem que o CLIENTE envia ao tocar "Quero reservar" na página pública.
export const mensagemAceite = (orc) => `Olá! Quero reservar o orçamento ${orc.codigo} (${brl(totais(orc.itens, orc.desconto_pct).total)}).`;
