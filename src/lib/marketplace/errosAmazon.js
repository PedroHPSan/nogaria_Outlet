// errosAmazon.js — traduz códigos de issue da Amazon Listings Items em
// bucket + mensagem pt-BR acionável. As mensagens são best-effort por código;
// ajustar conforme os erros reais forem aparecendo na conta.

const MAPA = {
  "13013": { bucket: "ATRIBUTO",  msg: "Atributo obrigatório faltando para a categoria." },
  "8058":  { bucket: "MARCA",     msg: "Sem permissão para listar esta marca/categoria (gated)." },
  "8560":  { bucket: "GTIN",      msg: "Produto não encontrado pelo identificador informado." },
  "8684":  { bucket: "GTIN",      msg: "GTIN/EAN inválido ou não reconhecido." },
  "18299": { bucket: "PRECO",     msg: "Preço fora da política da Amazon (muito alto ou baixo)." },
  "18749": { bucket: "IMAGEM",    msg: "Imagem principal obrigatória ou inválida." },
  "5461":  { bucket: "MARCA",     msg: "Restrição de marca/propriedade intelectual (Brand Registry)." },
  "18503": { bucket: "CATEGORIA", msg: "Categoria exige aprovação para listar." },
  "18653": { bucket: "CONDICAO",  msg: "Condição informada inválida para esta oferta." },
  "90188": { bucket: "GTIN",      msg: "Identificador já associado a outro produto (ASIN)." },
  "90226": { bucket: "ATRIBUTO",  msg: "Valor de atributo inválido." },
  "18555": { bucket: "DUPLICADO", msg: "SKU já existe / oferta duplicada." },
  "18320": { bucket: "ESTOQUE",   msg: "Quantidade ou canal de fulfillment inválido." },
  "18329": { bucket: "PRECO",     msg: "Preço ou moeda inválidos." },
};

// Retorna { bucket, msg } para um código. Desconhecidos caem em DESCONHECIDO + fallback.
export function traduzErro(code, fallback = "Erro desconhecido da Amazon.") {
  const k = String(code ?? "").trim();
  return MAPA[k] || { bucket: "DESCONHECIDO", msg: fallback || `Código ${k}` };
}

export const BUCKETS_AMAZON = MAPA;
