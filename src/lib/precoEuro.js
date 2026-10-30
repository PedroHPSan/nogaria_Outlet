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

// "259,80 €" (es/pt: símbolo depois) ou "€259.80" (en).
export const fmtEUR = (v, lang = "pt") => (lang === "en"
  ? `€${Number(v).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const fmtBRL2 = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// "30/10/2026 17:05 UTC" (padrão: sem ambiguidade para quem lê na Europa). Opções: { tz } com
// rótulo "Brasília" (equipe) ou { local: true } no fuso do visitante com a sigla (página pública).
export function fmtDataCotacao(ts, { tz = "UTC", local = false } = {}) {
  const d = new Date(ts);
  const base = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
  if (local) return d.toLocaleString("pt-BR", { ...base, timeZoneName: "short" }).replace(",", "");
  const txt = d.toLocaleString("pt-BR", { ...base, timeZone: tz }).replace(",", "");
  return `${txt} ${tz === "UTC" ? "UTC" : tz === "America/Sao_Paulo" ? "(Brasília)" : tz}`;
}

export const IDIOMAS = ["pt", "en", "es"];
const BANDEIRA = { pt: "🇧🇷", en: "🇬🇧", es: "🇪🇸" };

// Textos do modo euro nos três idiomas (grupo de WhatsApp, preview e página).
export const T = {
  pt: {
    cotacao: "Cotação", atualiza: "Ao clicar no link, o valor em euros é atualizado com a cotação do momento.",
    curto: "Valor em € atualizado ao abrir o link",
    preview: "Preço atualizado ao clicar", quero: "Quero este", vendido: "Vendido", buscando: "Buscando a cotação do euro…",
    falhou: "Não foi possível obter a cotação agora; recarregue a página.",
    confirmaTitulo: "Confirme o valor", confirmaAviso: "Valor recalculado agora, com a cotação atual. É este o valor da sua compra.",
    confirmar: "Confirmar e chamar no WhatsApp", voltar: "Voltar", semValor: "Falar no WhatsApp (valor combinado na conversa)",
    pagar: "Pagamento em euros por transferência para uma conta na Espanha. A Nogária envia os dados após a confirmação.",
    entrega: "Entrega: combinada na conversa (envio internacional, impostos e frete não incluídos).",
    privacidade: "Contamos os acessos à página sem coletar dados pessoais. A cotação vem dos nossos servidores.",
    verEuros: "Mora na Europa? Ver o preço em euros", verReais: "Ver em reais (R$)", fonte: "Fonte da cotação", consultada: "consultada às", lgpd: "A cotação é consultada pelos servidores da Nogária; seus dados pessoais não são enviados à fonte.",
    pedido: "Pedido", indisponivel: "Oferta indisponível",
    indisponivelDesc: "Este link expirou ou não existe. Chame a Nogária Outlet para ver as ofertas do dia.",
    ola: "Olá! Tenho interesse em", rodape: "Preços e disponibilidade sujeitos a alteração. Peças de outlet, com condição descrita.",
  },
  en: {
    cotacao: "Rate", atualiza: "When you click the link, the euro price is updated with the current exchange rate.",
    curto: "Euro price updates when you open the link",
    preview: "Price updates on click", quero: "I want this", vendido: "Sold", buscando: "Fetching the euro rate…",
    falhou: "Could not get the exchange rate now; please reload the page.",
    confirmaTitulo: "Confirm the price", confirmaAviso: "Price recalculated just now with the current rate. This is the price of your purchase.",
    confirmar: "Confirm and chat on WhatsApp", voltar: "Back", semValor: "Chat on WhatsApp (price agreed in the chat)",
    pagar: "Payment in euros by bank transfer to an account in Spain. Nogária sends the details after confirmation.",
    entrega: "Delivery: arranged in the chat (international shipping, taxes and freight not included).",
    privacidade: "We count page visits without collecting personal data. The exchange rate comes from our own servers.",
    verEuros: "Live in Europe? See the price in euros", verReais: "See in reais (R$)", fonte: "Rate source", consultada: "checked at", lgpd: "The rate is fetched by Nogária's servers; your personal data is not sent to the source.",
    pedido: "Order", indisponivel: "Offer unavailable",
    indisponivelDesc: "This link has expired or does not exist. Contact Nogária Outlet to see today's offers.",
    ola: "Hello! I'm interested in", rodape: "Prices and availability subject to change. Outlet items, condition described.",
  },
  es: {
    cotacao: "Cotización", atualiza: "Al hacer clic en el enlace, el precio en euros se actualiza con la cotización del momento.",
    curto: "Precio en € actualizado al abrir el enlace",
    preview: "Precio actualizado al clic", quero: "Lo quiero", vendido: "Vendido", buscando: "Buscando la cotización del euro…",
    falhou: "No se pudo obtener la cotización ahora; recargue la página.",
    confirmaTitulo: "Confirme el precio", confirmaAviso: "Precio recalculado ahora con la cotización actual. Este es el precio de su compra.",
    confirmar: "Confirmar y escribir por WhatsApp", voltar: "Volver", semValor: "Escribir por WhatsApp (precio acordado en el chat)",
    pagar: "Pago en euros por transferencia a una cuenta en España. Nogária envía los datos tras la confirmación.",
    entrega: "Entrega: se acuerda en el chat (envío internacional, impuestos y flete no incluidos).",
    privacidade: "Contamos las visitas a la página sin recopilar datos personales. La cotización viene de nuestros servidores.",
    verEuros: "¿Vive en Europa? Ver el precio en euros", verReais: "Ver en reales (R$)", fonte: "Fuente de la cotización", consultada: "consultada a las", lgpd: "La cotización la consulta Nogária desde sus servidores; sus datos personales no se envían a la fuente.",
    pedido: "Pedido", indisponivel: "Oferta no disponible",
    indisponivelDesc: "Este enlace ha caducado o no existe. Contacte con Nogária Outlet para ver las ofertas del día.",
    ola: "¡Hola! Me interesa", rodape: "Precios y disponibilidad sujetos a cambios. Artículos de outlet, con condición descrita.",
  },
};

// Fonte da cotação, por extenso, para o cliente (transparência/LGPD).
const FONTES = {
  awesomeapi: "AwesomeAPI — câmbio comercial EUR/BRL (economia.awesomeapi.com.br)",
  frankfurter: "Frankfurter / Banco Central Europeu — taxa de referência do dia (frankfurter.app)",
};
export const fonteCotacao = (fonte) => FONTES[fonte] || "Cotação EUR/BRL de mercado";

// "14:05:32" no fuso do visitante: momento em que a cotação foi consultada (segundo a segundo).
export const horaConsulta = (ts) => new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// pt / es mantêm o idioma; qualquer outro (en, fr, de, it…) cai em inglês.
export const idiomaDoNavegador = (nav = (typeof navigator !== "undefined" ? navigator.language : "")) => {
  const l = String(nav || "").slice(0, 2).toLowerCase();
  return IDIOMAS.includes(l) ? l : "en";
};

// Público padrão da página: quem usa português do Brasil vê R$; os demais (es, pt-PT, en…) veem €.
export const publicoPadrao = (nav = (typeof navigator !== "undefined" ? navigator.language : "")) =>
  /^pt(-br)?$/i.test(String(nav || "")) ? "br" : "eu";

// "Cotação: 1 € = R$ 6,35 (30/10/2026 17:05 UTC)".
export const textoCotacao = ({ taxa, em }, lang = "pt", opts) => `${T[lang].cotacao}: 1 € = ${fmtBRL2(taxa)} (${fmtDataCotacao(em, opts)})`;

// Descrição do preview (og:description): aviso nos 3 idiomas.
export const descricaoPreviewEuro = () => IDIOMAS.map((l) => T[l].preview).join(" · ");

// "259,80 €" — o € já leva o acréscimo; o R$ de quem paga em reais é o valor base, sem acréscimo.
export function eurTexto(brlBase, taxa, { negrito = false, lang = "pt" } = {}) {
  const m = precoMisto(brlBase, taxa);
  return m?.eur ? (negrito ? `*${fmtEUR(m.eur, lang)}*` : fmtEUR(m.eur, lang)) : "";
}

// "R$ 1.299,00 · 259,80 €" (cartão e mensagem do grupo: um link para os dois públicos; o R$ vem primeiro).
export function duplaPreco(brlBase, taxa, opts) {
  const eur = eurTexto(brlBase, taxa, opts);
  return eur && Number(brlBase) > 0 ? `${fmtBRL2(brlBase)} · ${eur}` : "";
}

// Mensagem do grupo (compacta): título, preço (1 produto), link, uma linha curta por idioma e a cotação uma vez.
export function textoGrupoEuro(payload, url, cotacao) {
  const linhas = [`*${payload.titulo}*`];
  if (payload.itens.length === 1) {
    const l = duplaPreco(payload.itens[0].preco, cotacao?.taxa, { negrito: false });
    if (l) linhas.push(l);
  }
  linhas.push(url, "");
  for (const l of IDIOMAS) linhas.push(`${BANDEIRA[l]} ${T[l].curto}`);
  linhas.push(`💱 1 € = ${fmtBRL2(cotacao.taxa)} (${fmtDataCotacao(cotacao.em)})`);
  return linhas.join("\n");
}

// Mensagem enviada à Bárbara ao confirmar o pedido (valores já recalculados; código do pedido, se registrado).
export function mensagemInteresseEuro(item, cotacao, url, lang = "pt", codigo = null) {
  const preco = eurTexto(item.preco, cotacao?.taxa, { lang });
  const ped = codigo ? ` [${T[lang].pedido} #${codigo}]` : "";
  return `${T[lang].ola} ${item.produto} (${item.sku})${preco ? ` — ${preco}` : ""}${ped}. ${textoCotacao(cotacao, lang)}. ${url || ""}`.trim();
}

// Selo e frase de condição nos 3 idiomas (o nome do produto segue no idioma do cadastro).
const BADGE = { novo: { en: "New", es: "Nuevo" }, aberta: { en: "Open box", es: "Caja abierta" }, semi: { en: "Pre-owned", es: "Seminuevo" }, asis: { en: "As is", es: "Tal como está" } };
const FRASE = [
  ["Produto novo, embalagem aberta ou avariada", { en: "New, open or damaged packaging", es: "Nuevo, embalaje abierto o dañado" }],
  ["Produto novo", { en: "Brand new", es: "Producto nuevo" }],
  ["Usado, em funcionamento", { en: "Used, working", es: "Usado, funciona" }],
  ["Vendido no estado em que se encontra", { en: "Sold as is", es: "Se vende tal como está" }],
];
export const traduzirBadge = (badge, lang) => (lang === "pt" || !badge ? badge?.txt : BADGE[badge.cls]?.[lang] || badge.txt);
export function traduzirCondicao(txt, lang) {
  if (lang === "pt" || !txt) return txt;
  const par = FRASE.find(([pt]) => String(txt).startsWith(pt));
  return par ? `${par[1][lang]}${String(txt).slice(par[0].length)}` : txt;
}
