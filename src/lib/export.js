// Fase 1 — Caminho A (Hub): exportação de produtos limpos para um integrador
// (Bling / Tiny-Olist / Magis5 / ANYMARKET). Funções puras + download client-side.
//
// Princípio do plano: o sistema é a fonte da verdade; o hub publica nos canais.
// GTIN NUNCA bloqueia a exportação — identidade cai para marca+modelo+categoria.

// Canais alvo do plano. ML é prioridade 1 para o lote usado.
export const CANAIS = ["Mercado Livre", "Amazon", "TikTok Shop", "Hiper"];

// Preço de venda efetivo: ideal > sugerido > mínimo (primeiro > 0).
export const precoVenda = (it) =>
  [it.preco_ideal, it.preco_sugerido, it.preco_min, it.preco_novo_est]
    .map(Number)
    .find((v) => v > 0) ?? null;

// Condição do anúncio: usa a capturada; senão deriva de `estado` (plano §1).
export const condicaoAnuncio = (it) => {
  if (it.condicao_anuncio) return it.condicao_anuncio;
  switch (it.estado) {
    case "Novo":
    case "Embalagem aberta/avariada": return "Novo";
    case "Usado":
    case "Usado funcionando":
    case "Usado sem teste":
    case "Avariado":
    case "Incompleto": return "Usado";
    default: return null;
  }
};

// Mínimo que um hub exige para criar um anúncio decente. GTIN/NCM ficam de fora
// de propósito (capturados oportunisticamente / na mesa).
export const camposObrigatorios = [
  { key: "produto", label: "Descrição", get: (it) => it.titulo_anuncio || it.produto },
  { key: "marca", label: "Marca", get: (it) => it.marca },
  { key: "modelo", label: "Modelo", get: (it) => it.modelo },
  { key: "condicao", label: "Condição", get: (it) => condicaoAnuncio(it) },
  { key: "preco", label: "Preço de venda", get: (it) => precoVenda(it) },
  { key: "quantidade", label: "Estoque", get: (it) => (Number(it.quantidade) > 0 ? it.quantidade : null) },
];

// Retorna { ok, faltando: [labels] } para um item.
export const checarCompletude = (it) => {
  const faltando = camposObrigatorios
    .filter((c) => {
      const v = c.get(it);
      return v === null || v === undefined || v === "";
    })
    .map((c) => c.label);
  return { ok: faltando.length === 0, faltando };
};

// Vazio? helper de campo (igual à regra de checarCompletude).
const vazio = (v) => v === null || v === undefined || v === "";
// Tem ao menos uma dimensão/peso (frete)? Aceita peso_real_kg/peso_kg + as 3 medidas.
const temDimensoes = (it) =>
  !vazio(it.peso_real_kg ?? it.peso_kg) &&
  !vazio(it.comprimento_cm) && !vazio(it.largura_cm) && !vazio(it.altura_cm);
const temFoto = (it) => it.foto_feita === true;

// Requisitos ADICIONAIS por canal (além de camposObrigatorios). Mercado Livre e Amazon
// pedem mais para um anúncio decente; TikTok valoriza mídia; Hiper (ERP) fica no mínimo.
const requisitosCanal = {
  "Mercado Livre": [
    { label: "GTIN/EAN", ok: (it) => !vazio(it.gtin) },
    { label: "NCM", ok: (it) => !vazio(it.ncm) },
    { label: "Dimensões/peso", ok: temDimensoes },
    { label: "Foto", ok: temFoto },
  ],
  "Amazon": [
    { label: "GTIN/EAN", ok: (it) => !vazio(it.gtin) },
    { label: "NCM", ok: (it) => !vazio(it.ncm) },
    { label: "Dimensões/peso", ok: temDimensoes },
    { label: "Foto", ok: temFoto },
  ],
  "TikTok Shop": [
    { label: "Foto", ok: temFoto },
    { label: "Dimensões/peso", ok: temDimensoes },
  ],
  "Hiper": [],
};

// Diagnóstico de prontidão por canal. Retorna [{ canal, pronto, faltando: [labels] }].
// Base = camposObrigatorios (checarCompletude) + requisitos extras do canal.
export const diagnosticarPorCanal = (it) => {
  const base = checarCompletude(it).faltando;
  return CANAIS.map((canal) => {
    const extra = (requisitosCanal[canal] || [])
      .filter((req) => !req.ok(it))
      .map((req) => req.label);
    const faltando = [...base, ...extra];
    return { canal, pronto: faltando.length === 0, faltando };
  });
};

// Colunas do CSV padrão de importação para hub (cabeçalhos em pt-BR, próximos
// das convenções de Bling/Tiny — a maioria dos hubs aceita mapear no import).
export const COLUNAS = [
  { header: "SKU", get: (it) => it.sku },
  { header: "Título", get: (it) => it.titulo_anuncio || it.produto },
  { header: "Descrição", get: (it) => it.descricao_anuncio || it.produto },
  { header: "Marca", get: (it) => it.marca },
  { header: "Modelo", get: (it) => it.modelo },
  { header: "Categoria", get: (it) => it.grupo },
  { header: "Condição", get: (it) => condicaoAnuncio(it) },
  { header: "GTIN/EAN", get: (it) => it.gtin },
  { header: "NCM", get: (it) => it.ncm },
  { header: "Preço", get: (it) => precoVenda(it) },
  { header: "Preço mínimo", get: (it) => it.preco_min },
  { header: "Estoque", get: (it) => it.quantidade },
  { header: "Voltagem", get: (it) => it.voltagem },
  { header: "Cor", get: (it) => it.cor },
  { header: "Peso (kg)", get: (it) => it.peso_real_kg ?? it.peso_kg },
  { header: "Comprimento (cm)", get: (it) => it.comprimento_cm },
  { header: "Largura (cm)", get: (it) => it.largura_cm },
  { header: "Altura (cm)", get: (it) => it.altura_cm },
  { header: "Medição", get: (it) => it.medidas_fonte || "Não medido" },
  { header: "Caixa", get: (it) => it.caixa_id },
  { header: "Nº de série", get: (it) => it.num_serie },
  { header: "Lote", get: (it) => it.lote },
  { header: "Canal sugerido", get: (it) => it.canal_principal },
];

// --- Amazon (flat file / postagem em massa) ---------------------------------
// Condição Amazon a partir de estado + embalagem. A Amazon BR não aceita "Novo"
// para itens de caixa aberta/avariada, então caem em "Usado - como novo".
export const condicaoAmazon = (it) => {
  const caixaAvariada = it.cond_embalagem && it.cond_embalagem !== "PERFEITA";
  let tipo, base;
  switch (it.estado) {
    case "Novo":
      if (caixaAvariada) { tipo = "UsedLikeNew"; base = "Produto novo, embalagem avariada"; }
      else { tipo = "New"; base = ""; }
      break;
    case "Embalagem aberta/avariada": tipo = "UsedLikeNew"; base = "Produto novo, embalagem aberta/avariada"; break;
    case "Usado":
    case "Usado funcionando": tipo = "UsedGood"; base = "Usado, funcionando e testado"; break;
    case "Usado sem teste": tipo = "UsedAcceptable"; base = "Usado, vendido sem teste"; break;
    case "Avariado": tipo = "UsedAcceptable"; base = "Usado com avaria estética"; break;
    default: tipo = "UsedGood"; base = "Usado";
  }
  const notas = [base];
  if (it.acessorios_ok === false) notas.push("acessórios incompletos");
  return { tipo, nota: notas.filter(Boolean).join("; ") };
};

const bullet = (it, i) => (Array.isArray(it.bullet_points) ? it.bullet_points[i] ?? "" : "");
const fichaTxt = (it) =>
  Array.isArray(it.ficha_tecnica) ? it.ficha_tecnica.map((f) => `${f.atributo}: ${f.valor}`).join(" | ") : "";
const idTipo = (g) => { const s = String(g || ""); return s.length === 13 ? "EAN" : s.length === 12 ? "UPC" : ""; };

// Colunas estilo flat file Amazon. Os atributos de categoria (product_type / browse
// node e specs por categoria) ficam fora — variam por template; a ficha técnica vai
// anexada na descrição. No upload da Amazon, mapeie estas colunas no template.
export const COLUNAS_AMAZON = [
  { header: "sku", get: (it) => it.sku },
  { header: "product-id", get: (it) => it.gtin },
  { header: "product-id-type", get: (it) => idTipo(it.gtin) },
  { header: "item-name", get: (it) => it.titulo_anuncio || it.produto },
  { header: "brand-name", get: (it) => it.marca },
  { header: "manufacturer", get: (it) => it.marca },
  { header: "part-number", get: (it) => it.modelo },
  { header: "product-description", get: (it) => {
      const d = it.descricao_anuncio || it.produto || "";
      const f = fichaTxt(it);
      return f ? `${d}\n\nFicha técnica: ${f}` : d;
    } },
  { header: "bullet-point1", get: (it) => bullet(it, 0) },
  { header: "bullet-point2", get: (it) => bullet(it, 1) },
  { header: "bullet-point3", get: (it) => bullet(it, 2) },
  { header: "bullet-point4", get: (it) => bullet(it, 3) },
  { header: "bullet-point5", get: (it) => bullet(it, 4) },
  { header: "generic-keywords", get: (it) => it.palavras_chave },
  { header: "standard-price", get: (it) => precoVenda(it) },
  { header: "quantity", get: (it) => (Number(it.quantidade) > 0 ? it.quantidade : 1) },
  { header: "condition-type", get: (it) => condicaoAmazon(it).tipo },
  { header: "condition-note", get: (it) => condicaoAmazon(it).nota },
  { header: "color-name", get: (it) => it.cor },
  { header: "ncm", get: (it) => it.ncm },
  { header: "voltage", get: (it) => it.voltagem },
  { header: "item-weight", get: (it) => it.peso_real_kg ?? it.peso_kg },
  { header: "item-weight-unit", get: () => "KG" },
  { header: "package-length", get: (it) => it.comprimento_cm },
  { header: "package-width", get: (it) => it.largura_cm },
  { header: "package-height", get: (it) => it.altura_cm },
  { header: "package-dimensions-unit", get: () => "CM" },
];

// Packing list de uma caixa: o conteúdo para conferência/envio.
export const COLUNAS_CAIXA = [
  { header: "SKU", get: (it) => it.sku },
  { header: "Produto", get: (it) => it.titulo_anuncio || it.produto },
  { header: "Categoria", get: (it) => it.grupo },
  { header: "Lote", get: (it) => it.lote },
  { header: "Comprimento (cm)", get: (it) => it.comprimento_cm },
  { header: "Largura (cm)", get: (it) => it.largura_cm },
  { header: "Altura (cm)", get: (it) => it.altura_cm },
  { header: "Peso (kg)", get: (it) => it.peso_real_kg ?? it.peso_kg },
];

// Relatório de campo para re-medição: o que conferir na bancada (SKU, onde está
// e os valores atuais, que podem ser estimativas a confirmar).
export const COLUNAS_MEDICAO = [
  { header: "SKU", get: (it) => it.sku },
  { header: "Produto", get: (it) => it.titulo_anuncio || it.produto },
  { header: "Categoria", get: (it) => it.grupo },
  { header: "Lote", get: (it) => it.lote },
  { header: "Local", get: (it) => it.local_fisico },
  { header: "Caixa", get: (it) => it.caixa_num },
  { header: "Comprimento (cm)", get: (it) => it.comprimento_cm },
  { header: "Largura (cm)", get: (it) => it.largura_cm },
  { header: "Altura (cm)", get: (it) => it.altura_cm },
  { header: "Peso (kg)", get: (it) => it.peso_real_kg ?? it.peso_kg },
  { header: "Medição", get: (it) => it.medidas_fonte || "Não medido" },
];

// Escapa um campo para CSV com delimitador ';' (padrão Excel pt-BR).
const escapeCampo = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Serializa itens em CSV. BOM UTF-8 (acentos no Excel) + CRLF + delimitador ';'.
export const toCSV = (itens, colunas = COLUNAS) => {
  const head = colunas.map((c) => escapeCampo(c.header)).join(";");
  const linhas = itens.map((it) => colunas.map((c) => escapeCampo(c.get(it))).join(";"));
  return "﻿" + [head, ...linhas].join("\r\n");
};

// Dispara download de um arquivo de texto no navegador.
export const baixarArquivo = (nome, conteudo, mime = "text/csv;charset=utf-8") => {
  const blob = new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
