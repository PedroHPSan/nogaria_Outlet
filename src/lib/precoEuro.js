// Preço misto R$ + € (PURO): para clientes do exterior, o valor em reais ganha +20% e é
// convertido em euros pela cotação do momento. Sem rede; testável em Node.

export const ACRESCIMO_EURO = 0.2;

const r2 = (v) => Math.round(v * 100) / 100;

// Valor em reais já com o acréscimo de 20%.
export const brlComAcrescimo = (brl) => (brl > 0 ? r2(brl * (1 + ACRESCIMO_EURO)) : null);

// { brl, eur }: brl = reais +20%; eur = brl ÷ cotação (R$ por 1 €). Sem preço/cotação → null.
export function precoMisto(brlBase, taxa) {
  const brl = brlComAcrescimo(Number(brlBase));
  if (!brl) return null;
  return { brl, eur: taxa > 0 ? r2(brl / taxa) : null };
}

export const fmtEUR = (v) => `€ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtBRL2 = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// "30/10/2026 14:05" no fuso de Brasília.
export const fmtDataCotacao = (ts) =>
  new Date(ts).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "");

export const IDIOMAS = ["pt", "en", "es"];
const BANDEIRA = { pt: "🇧🇷", en: "🇬🇧", es: "🇪🇸" };

// Textos do modo euro nos três idiomas (grupo de WhatsApp, preview e página).
export const T = {
  pt: {
    cotacao: "Cotação", atualiza: "Ao clicar no link, o valor em euros é atualizado com a cotação do momento.",
    preview: "Preço atualizado ao clicar", quero: "Quero este", vendido: "Vendido", buscando: "Buscando a cotação do euro…",
    falhou: "Não foi possível obter a cotação agora; recarregue a página.",
    confirmaTitulo: "Confirme o valor", confirmaAviso: "Valor recalculado agora, com a cotação atual. É este o valor da sua compra.",
    confirmar: "Confirmar e chamar no WhatsApp", voltar: "Voltar",
    ola: "Olá! Tenho interesse em", rodape: "Preços e disponibilidade sujeitos a alteração. Peças de outlet, com condição descrita.",
  },
  en: {
    cotacao: "Rate", atualiza: "When you click the link, the euro price is updated with the current exchange rate.",
    preview: "Price updates on click", quero: "I want this", vendido: "Sold", buscando: "Fetching the euro rate…",
    falhou: "Could not get the exchange rate now; please reload the page.",
    confirmaTitulo: "Confirm the price", confirmaAviso: "Price recalculated just now with the current rate. This is the price of your purchase.",
    confirmar: "Confirm and chat on WhatsApp", voltar: "Back",
    ola: "Hello! I'm interested in", rodape: "Prices and availability subject to change. Outlet items, condition described.",
  },
  es: {
    cotacao: "Cotización", atualiza: "Al hacer clic en el enlace, el precio en euros se actualiza con la cotización del momento.",
    preview: "Precio actualizado al hacer clic", quero: "Lo quiero", vendido: "Vendido", buscando: "Buscando la cotización del euro…",
    falhou: "No se pudo obtener la cotización ahora; recargue la página.",
    confirmaTitulo: "Confirme el precio", confirmaAviso: "Precio recalculado ahora con la cotización actual. Este es el precio de su compra.",
    confirmar: "Confirmar y escribir por WhatsApp", voltar: "Volver",
    ola: "¡Hola! Me interesa", rodape: "Precios y disponibilidad sujetos a cambios. Artículos de outlet, con condición descrita.",
  },
};

export const idiomaDoNavegador = (nav = (typeof navigator !== "undefined" ? navigator.language : "")) => {
  const l = String(nav || "").slice(0, 2).toLowerCase();
  return IDIOMAS.includes(l) ? l : "pt";
};

// "Cotação: 1 € = R$ 6,35 (30/10/2026 14:05)".
export const textoCotacao = ({ taxa, em }, lang = "pt") => `${T[lang].cotacao}: 1 € = ${fmtBRL2(taxa)} (${fmtDataCotacao(em)})`;

// Descrição do preview (og:description): aviso nos 3 idiomas.
export const descricaoPreviewEuro = () => IDIOMAS.map((l) => T[l].preview).join(" · ");

// "€ 259,80 · R$ 1.558,80" (sem rótulo de acréscimo).
export function duplaPreco(brlBase, taxa, { negrito = false } = {}) {
  const m = precoMisto(brlBase, taxa);
  if (!m) return "";
  const eur = m.eur ? (negrito ? `*${fmtEUR(m.eur)}*` : fmtEUR(m.eur)) : null;
  return [eur, fmtBRL2(m.brl)].filter(Boolean).join(" · ");
}

// Mensagem do grupo: título, preço (1 produto), link e, em PT/EN/ES, cotação + aviso de atualização.
export function textoGrupoEuro(payload, url, cotacao) {
  const linhas = [`*${payload.titulo}*`];
  if (payload.itens.length === 1) {
    const l = duplaPreco(payload.itens[0].preco, cotacao?.taxa, { negrito: true });
    if (l) linhas.push(l);
  }
  linhas.push(url, "");
  for (const l of IDIOMAS) linhas.push(`${BANDEIRA[l]} ${textoCotacao(cotacao, l)}. ${T[l].atualiza}`);
  return linhas.join("\n");
}

// Mensagem enviada à Bárbara ao confirmar o pedido (valores já recalculados).
export function mensagemInteresseEuro(item, cotacao, url, lang = "pt") {
  const preco = duplaPreco(item.preco, cotacao?.taxa);
  return `${T[lang].ola} ${item.produto} (${item.sku})${preco ? ` — ${preco}` : ""}. ${textoCotacao(cotacao, lang)}. ${url || ""}`.trim();
}
