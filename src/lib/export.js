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
    case "Novo": return "Novo";
    case "Usado funcionando":
    case "Usado sem teste": return "Usado";
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
  { header: "Nº de série", get: (it) => it.num_serie },
  { header: "Lote", get: (it) => it.lote },
  { header: "Canal sugerido", get: (it) => it.canal_principal },
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
