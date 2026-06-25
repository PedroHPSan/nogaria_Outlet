// amazonPayload.js — monta o payload da Amazon Listings Items API (modo OFERTA).
// JS puro (sem rede), testável por node. A Edge `publicar-amazon` espelha esta lógica.
// Preço SEMPRE de preco_ideal (o gate garante > 0); nunca fallback.

export const MARKETPLACE_ID = "A2Q3Y263D00KWC"; // Amazon BR

// estado (+ condição da embalagem) → condition_type da Listings Items.
// A Amazon BR não aceita "novo" para caixa aberta/avariada → cai em used_like_new.
export function condicaoAmazonListings(estado, condEmbalagem) {
  const caixaAvariada = condEmbalagem && condEmbalagem !== "PERFEITA";
  switch (estado) {
    case "Novo": return caixaAvariada ? "used_like_new" : "new_new";
    case "Embalagem aberta/avariada": return "used_like_new";
    case "Usado":
    case "Usado funcionando": return "used_good";
    case "Usado sem teste": return "used_acceptable";
    case "Avariado": return "used_acceptable";
    default: return "used_good";
  }
}

// Monta o body do PUT /listings/2021-08-01/items (modo oferta). `idProduto` vem do
// gate: { tipo: "EAN"|"UPC"|"GTIN"|"ASIN", valor }.
export function montarPayloadAmazon(item, idProduto) {
  const preco = Number(item?.preco_ideal);
  const qtd = Number(item?.quantidade) > 0 ? Number(item.quantidade) : 1;

  const attributes = {
    condition_type: [{ marketplace_id: MARKETPLACE_ID, value: condicaoAmazonListings(item?.estado, item?.cond_embalagem) }],
    purchasable_offer: [{
      marketplace_id: MARKETPLACE_ID,
      currency: "BRL",
      our_price: [{ schedule: [{ value_with_tax: preco }] }],
    }],
    fulfillment_availability: [{ fulfillment_channel_code: "DEFAULT", quantity: qtd }],
  };

  if (idProduto?.tipo === "ASIN") {
    attributes.merchant_suggested_asin = [{ marketplace_id: MARKETPLACE_ID, value: idProduto.valor }];
  } else if (idProduto?.valor) {
    attributes.externally_assigned_product_identifier = [{
      marketplace_id: MARKETPLACE_ID,
      type: String(idProduto.tipo || "").toLowerCase(),
      value: idProduto.valor,
    }];
  }

  return { productType: "PRODUCT", requirements: "LISTING_OFFER_ONLY", attributes };
}
