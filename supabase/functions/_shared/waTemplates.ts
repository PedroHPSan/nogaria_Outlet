// Fonte ÚNICA dos templates utility do WhatsApp (cobrança, pagamento, entrega) — usada pela Edge Function
// (parâmetros reais) e pelo app (prévia). Sem APIs de Deno/DOM. O `corpo` deve ser IDÊNTICO ao texto
// aprovado na Meta (idioma pt_BR); parâmetros não podem ter quebra de linha.

export type Evento = "cobranca" | "pago" | "entrega";
export type SacolaWa = {
  codigo: string; cliente_nome?: string | null; total: number | string; validade?: string | null;
  itens: { sku: string; produto?: string }[];
};

export const TEMPLATES: Record<Evento, { nome: string; corpo: string }> = {
  cobranca: {
    nome: "cobranca_sacola",
    corpo: "Olá, {{1}}! Sua reserva da sacola {{2}} está confirmada: {{3}}. Total: {{4}}. Válida até {{5}}. Para concluir o pedido, responda com o comprovante de pagamento.",
  },
  pago: {
    nome: "pagamento_confirmado",
    corpo: "Olá, {{1}}! Recebemos o pagamento da sacola {{2}} ({{3}}). Obrigado! Avisamos quando o pedido for enviado.",
  },
  entrega: {
    nome: "pedido_enviado",
    corpo: "Olá, {{1}}! Seu pedido {{2}} foi enviado. Obrigado pela compra na Nogária Outlet!",
  },
};
export const EVENTOS = Object.keys(TEMPLATES) as Evento[];

const limpa = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
const brl = (n: number | string) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function resumoItens(itens: SacolaWa["itens"]): string {
  const lista = itens.map((i) => `${i.produto ?? i.sku} (${i.sku})`).join(", ");
  const base = `${itens.length} ${itens.length === 1 ? "item" : "itens"}: ${lista}`;
  return base.length > 150 ? base.slice(0, 147) + "..." : base;
}

// Parâmetros do corpo, na ordem {{1}}, {{2}}...
export function paramsEvento(evento: Evento, s: SacolaWa): string[] {
  const nome = limpa(s.cliente_nome || "cliente");
  if (evento === "cobranca") {
    const ate = s.validade ? new Date(s.validade).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }) : "em breve";
    return [nome, s.codigo, limpa(resumoItens(s.itens)), brl(s.total), ate];
  }
  if (evento === "pago") return [nome, s.codigo, brl(s.total)];
  return [nome, s.codigo];
}

export const previa = (evento: Evento, params: string[]) =>
  TEMPLATES[evento].corpo.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");

export const idemKeyEnvio = (refTipo: string, ref: string, evento: Evento) => `wa:${refTipo}:${ref}:${evento}`;

// Número para a Cloud API: só dígitos; 10–11 dígitos (DDD+número do Brasil) ganham o DDI 55.
export function numeroWa(bruto: string | null | undefined): string | null {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d.length >= 12 && d.length <= 15 ? d : null;
}
