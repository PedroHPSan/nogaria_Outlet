// adapter.js — adapter pattern de publicação em marketplace. O Hub (UI) fala SÓ com
// o adapter; só o AmazonAdapter conhece o nome da Edge Function. Para plugar
// Mercado Livre/Shopee depois, basta um novo adapter no registro `adapters`.
import { supabase } from "../supabase";

export class MarketplaceAdapter {
  get canal() { throw new Error("MarketplaceAdapter.canal não implementado"); }
  // eslint-disable-next-line no-unused-vars
  async publicar(sku) { throw new Error("MarketplaceAdapter.publicar não implementado"); }
  // eslint-disable-next-line no-unused-vars
  async pausar(sku) { throw new Error("MarketplaceAdapter.pausar não implementado"); }
}

export class AmazonAdapter extends MarketplaceAdapter {
  get canal() { return "amazon"; }

  async publicar(sku) {
    const { data, error } = await supabase.functions.invoke("publicar-amazon", { body: { sku } });
    if (error) return { ok: false, estado: "erro", erros: [{ bucket: "REDE", msg: error.message || "Falha ao chamar a função." }] };
    return data;
  }

  async pausar(sku) {
    const { data, error } = await supabase.functions.invoke("publicar-amazon", { body: { sku, acao: "pausar" } });
    if (error) return { ok: false, estado: "erro", erros: [{ bucket: "REDE", msg: error.message || "Falha ao chamar a função." }] };
    return data;
  }
}

const adapters = { amazon: new AmazonAdapter() };

// Retorna o adapter do canal (ex.: "amazon") ou null se não suportado.
export function getAdapter(canal) {
  return adapters[canal] || null;
}

export const CANAIS_PUBLICACAO = Object.keys(adapters);
