// Sacola do cliente no WhatsApp (PURO): casar cliente, somar item, resumo de cobrança.
// Sem rede — importável em testes Node.
import { snapshotItens, totais, statusEfetivo } from "./orcamentosCore.js";

export const FORMAS_PAGAMENTO = ["Pix", "Dinheiro", "Cartão", "Transferência", "Outro"];

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
export function adicionarItem(itensSacola, item) {
  const [snap] = snapshotItens([item]);
  if (!(Number(snap.preco) > 0)) throw new Error(`${item.sku}: sem preço de venda — defina o preço antes de separar.`);
  if ((itensSacola || []).some((i) => i.sku === snap.sku)) return itensSacola;
  return [...(itensSacola || []), snap];
}

export const removerItem = (itensSacola, sku) => (itensSacola || []).filter((i) => i.sku !== sku);

// Resumo do que falta receber/entregar. `agora` torna o vencimento testável.
export function resumoSacolas(sacolas, agora = new Date()) {
  const r = { abertas: 0, aReceber: 0, vencendo: 0, pagasSemEntrega: 0, recebido: 0 };
  for (const s of sacolas || []) {
    if (s.origem !== "whatsapp") continue;
    const st = statusEfetivo(s, agora);
    if (st === "ABERTA") {
      r.abertas++;
      r.aReceber += totais(s.itens, s.desconto_pct).total;
      if (new Date(s.validade) - new Date(agora) < 86400000) r.vencendo++;
    } else if (st === "VENDIDO") { r.pagasSemEntrega++; r.recebido += Number(s.valor_pago) || 0; }
    else if (st === "ENTREGUE") r.recebido += Number(s.valor_pago) || 0;
  }
  return r;
}

const brl = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 })}`;

// Lembrete de pagamento que o vendedor manda ao cliente.
export function mensagemCobranca(sacola) {
  const t = totais(sacola.itens, sacola.desconto_pct);
  const linhas = (sacola.itens || []).map((i) => `• ${i.produto} (${i.sku}) — ${brl(i.preco)}`);
  const ate = sacola.validade ? new Date(sacola.validade).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : null;
  return [
    `Olá${sacola.cliente_nome ? `, ${sacola.cliente_nome}` : ""}! Separei para você:`,
    ...linhas,
    `*Total: ${brl(t.total)}*`,
    ate ? `Seguro até ${ate}. Me avisa quando fizer o pagamento!` : "Me avisa quando fizer o pagamento!",
  ].join("\n");
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
    if (st === "ABERTA") c.aPagar += totais(s.itens, s.desconto_pct).total;
    else { c.pago += Number(s.valor_pago) || 0; if (st === "VENDIDO") c.aEntregar++; }
    mapa.set(chave, c);
  }
  return [...mapa.values()].sort((a, b) => (b.pago + b.aPagar) - (a.pago + a.aPagar));
}
