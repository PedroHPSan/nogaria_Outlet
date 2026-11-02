// Vendas, entrega e lucratividade por lote. Lógica de dados isolada dos componentes,
// espelhando o padrão de conferencia.js/caixas.js. 1 SKU = 1 unidade → a venda é 1:1
// com o item, gravada como colunas em `itens` (sem tabela `vendas`).
import { supabase } from "./supabase";

// Registra a venda de um item pela RPC `baixar_venda` (atômica): grava os detalhes (valor bruto,
// canal real, taxa, frete, comprador, nº do pedido) + VENDIDO + `vendido_em` + auditoria, e recusa
// item já vendido ou reservado por outra origem.
// `dados` traz os campos do card "Venda" do ItemDetail.
export async function registrarVenda(sku, dados, user) {
  const { error } = await supabase.rpc("baixar_venda", {
    p_sku: sku,
    p_valor: dados.valor_vendido ?? null,
    p_canal_venda: dados.canal_venda || null,
    p_pedido_ref: dados.pedido_ref?.trim() || null,
    p_comprador: dados.comprador?.trim() || null,
    p_taxa: dados.taxa_venda ?? null,
    p_frete: dados.frete_pago ?? null,
    p_user: user.email,
  });
  if (error) throw error;
}

// Marca um item já vendido como entregue/enviado ao comprador (carimbo + auditoria).
// Best-effort no evento, espelhando marcarConferido.
export async function marcarEntregue(sku, user) {
  const { error } = await supabase
    .from("itens")
    .update({ status: "ENTREGUE", entregue_em: new Date().toISOString(), upd_by: user.email })
    .eq("sku", sku);
  if (error) throw error;
  try {
    await supabase.from("eventos").insert({ sku, acao: "status:ENTREGUE", usuario: user.email });
  } catch { /* auditoria best-effort */ }
}

// Vendas agregadas por método (canal_venda). Inclui VENDIDO e ENTREGUE. Agrega no
// cliente (sem view): canais reais de venda são livres e poucos. "Não informado"
// agrupa vendas sem canal preenchido.
export async function carregarVendasPorCanal() {
  const PAGE = 1000;
  let rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("itens")
      .select("canal_venda, valor_vendido")
      .in("status", ["VENDIDO", "ENTREGUE"])
      .order("sku")
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    rows = rows.concat(data);
    if (data.length < PAGE) break;
  }
  const map = {};
  for (const r of rows) {
    const k = r.canal_venda || "Não informado";
    const m = (map[k] = map[k] || { canal: k, n: 0, total: 0 });
    m.n++;
    m.total += Number(r.valor_vendido) || 0;
  }
  return Object.values(map).sort((a, b) => b.total - a.total);
}

// Lê o resultado realizado por lote (view vw_lote_resultado). Pagina com .range()
// (padrão do Dashboard) para não travar em 1.000 linhas caso haja muitos lotes.
export async function carregarResultadoLotes() {
  const PAGE = 1000;
  let rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("vw_lote_resultado")
      .select("*")
      .order("lote")
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    rows = rows.concat(data);
    if (data.length < PAGE) break;
  }
  return rows;
}
