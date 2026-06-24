// pricingParams.js — carrega os parâmetros do motor das tabelas pricing_* no Supabase
// e monta o objeto no shape esperado por precificar(). Cacheia em memória.
import { supabase } from "./supabase";
import { DEFAULT_PARAMS } from "./pricing";

let _cache = null;

export async function carregarParametros() {
  if (_cache) return _cache;
  try {
    const [cfg, cond, risco, canal, grupo, emb] = await Promise.all([
      supabase.from("pricing_config").select("*"),
      supabase.from("pricing_factor_condicao").select("*"),
      supabase.from("pricing_factor_risco").select("*"),
      supabase.from("pricing_canal").select("*"),
      supabase.from("pricing_grupo").select("*"),
      supabase.from("pricing_factor_embalagem").select("*"),
    ]);
    const C = {};
    (cond.data || []).forEach((r) => (C[r.codigo] = { fator: Number(r.fator), ancora: r.ancora }));
    const E = {};
    (emb.data || []).forEach((r) => (E[r.codigo] = Number(r.fator)));
    const R = {};
    (risco.data || []).forEach((r) => (R[r.nivel] = Number(r.fator)));
    const K = {};
    (canal.data || []).forEach((r) => (K[r.codigo] = { takeRate: Number(r.take_rate), fixo: Number(r.fixo) }));
    const g = {};
    (cfg.data || []).forEach((r) => (g[r.key] = r.valor != null ? Number(r.valor) : r.valor_txt));
    const grupos = {};
    (grupo.data || []).forEach((r) => (grupos[r.grupo] = {
      nivelRisco: r.nivel_risco, ancoraNovo: r.ancora_novo, ancoraUsado: r.ancora_usado, classe: r.classe,
    }));
    _cache = {
      condicao: Object.keys(C).length ? C : DEFAULT_PARAMS.condicao,
      embalagemFator: Object.keys(E).length ? E : DEFAULT_PARAMS.embalagemFator,
      risco: Object.keys(R).length ? R : DEFAULT_PARAMS.risco,
      canal: Object.keys(K).length ? K : DEFAULT_PARAMS.canal,
      grupos,
      config: {
        margemSP: g.margem_sp ?? 0.30, margemBelem: g.margem_belem ?? 0.50,
        reserva: g.reserva ?? 0.05, embalagem: g.embalagem ?? 25,
        freteKg: g.frete_kg ?? 3.0, freteMin: g.frete_min ?? 15,
        convNovoUsado: g.conv_novo_usado ?? 0.60, condicaoPadrao: g.condicao_padrao ?? "USADO_OK",
        testeValorMin: g.teste_valor_min ?? 150, // limite p/ exigir teste por valor (política de risco)
      },
    };
    return _cache;
  } catch (e) {
    console.error("Falha ao carregar parâmetros de precificação, usando defaults", e);
    return DEFAULT_PARAMS;
  }
}
export const limparCacheParametros = () => { _cache = null; };
