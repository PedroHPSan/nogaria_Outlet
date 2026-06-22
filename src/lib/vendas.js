// Vendas, entrega e lucratividade por lote. Lógica de dados isolada dos componentes,
// espelhando o padrão de conferencia.js/caixas.js. 1 SKU = 1 unidade → a venda é 1:1
// com o item, gravada como colunas em `itens` (sem tabela `vendas`).
import { supabase } from "./supabase";

// Registra a venda de um item: grava os detalhes (valor bruto, canal real, taxa, frete,
// comprador, nº do pedido) + status VENDIDO + carimbo `vendido_em` + auditoria.
// `dados` traz os campos do card "Venda" do ItemDetail.
export async function registrarVenda(sku, dados, user) {
  const { error } = await supabase
    .from("itens")
    .update({
      valor_vendido: dados.valor_vendido ?? null,
      canal_venda: dados.canal_venda || null,
      taxa_venda: dados.taxa_venda ?? null,
      frete_pago: dados.frete_pago ?? null,
      comprador: dados.comprador?.trim() || null,
      pedido_ref: dados.pedido_ref?.trim() || null,
      status: "VENDIDO",
      vendido_em: new Date().toISOString(),
      upd_by: user.email,
    })
    .eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku, acao: "status:VENDIDO", usuario: user.email });
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
