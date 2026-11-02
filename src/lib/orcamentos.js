// Orçamentos persistidos: criar, listar, enviar, reservar, cancelar e converter em
// venda (via registrarVenda, 1 SKU = 1 venda). Regras puras em orcamentosCore.js.
import { supabase } from "./supabase";
import { gerarSlug } from "./catalogoPublico";
import { EMPRESA } from "./empresa";
import {
  codigoOrcamento, proximoSeq, snapshotItens, totais, validadeEm, podeTransitar, valoresPorItem,
} from "./orcamentosCore";

export const linkOrcamento = (slug) => `${window.location.origin}/o/${slug}`;

async function ultimoCodigo() {
  const { data } = await supabase.from("orcamentos").select("codigo").order("codigo", { ascending: false }).limit(1);
  return data?.[0]?.codigo || null;
}

// itens: linhas de `itens` (preço de venda é congelado no snapshot).
export async function criarOrcamento(itens, { clienteNome, clienteWhatsapp, descontoPct = 0, vendedorNome, vendedorWhatsapp } = {}, user) {
  const snap = snapshotItens(itens);
  const t = totais(snap, descontoPct);
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const codigo = codigoOrcamento(proximoSeq(await ultimoCodigo()));
    const { data, error } = await supabase.from("orcamentos").insert({
      codigo, slug: gerarSlug(), status: "RASCUNHO", itens: snap, desconto_pct: t.pct, total: t.total,
      cliente_nome: clienteNome?.trim() || null, cliente_whatsapp: clienteWhatsapp?.replace(/\D/g, "") || null,
      vendedor_nome: vendedorNome?.trim() || null, vendedor_whatsapp: vendedorWhatsapp?.replace(/\D/g, "") || EMPRESA.whatsapp,
      validade: validadeEm(), criado_por: user?.email,
    }).select("*").single();
    if (!error) return data;
    if (error.code !== "23505") throw error; // só repete em colisão de código/slug
  }
  throw new Error("Não foi possível gerar um código de orçamento único. Tente novamente.");
}

export async function listarOrcamentos({ status, q } = {}) {
  let query = supabase.from("orcamentos").select("*").order("criado_em", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);
  if (q?.trim()) query = query.or(`codigo.ilike.%${q.trim()}%,cliente_nome.ilike.%${q.trim()}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function mudarStatus(orc, para, extra = {}) {
  if (!podeTransitar(orc.status, para)) throw new Error(`Orçamento ${orc.codigo}: ${orc.status} → ${para} não é permitido.`);
  const { data, error } = await supabase.from("orcamentos")
    .update({ status: para, atualizado_em: new Date().toISOString(), ...extra }).eq("id", orc.id).select("*").single();
  if (error) throw error;
  return data;
}

export const marcarEnviado = (orc) => mudarStatus(orc, "ENVIADO");

// Reserva os itens por 48 h (tudo ou nada). Recusa se algum já estiver reservado por OUTRA origem.
export async function reservarOrcamento(orc, user) {
  const ate = validadeEm();
  const { error } = await supabase.rpc("reservar_itens", {
    p_skus: orc.itens.map((i) => i.sku), p_canal: "direto", p_origem_tipo: "sacola",
    p_origem_ref: orc.codigo, p_expira_em: ate, p_user: user.email,
  });
  if (error) throw error;
  return mudarStatus(orc, "RESERVADO", { validade: ate });
}

async function liberarReserva(orc) {
  const { error } = await supabase.rpc("liberar_reserva", { p_origem_tipo: "sacola", p_origem_ref: orc.codigo });
  if (error) throw error;
}

export async function cancelarOrcamento(orc) {
  const novo = await mudarStatus(orc, "CANCELADO");
  await liberarReserva(orc);
  return novo;
}

// Converte em venda: `baixar_vendas` (tudo ou nada) com o valor já com desconto rateado. Item vendido
// ou reservado por outra origem faz a RPC falhar sem venda parcial.
export async function confirmarVenda(orc, user, { canal = "B2C / Venda direta" } = {}) {
  if (!podeTransitar(orc.status, "VENDIDO")) throw new Error(`Orçamento ${orc.codigo} está ${orc.status}.`);
  const { error } = await supabase.rpc("baixar_vendas", {
    p_itens: valoresPorItem(orc.itens, orc.desconto_pct).map((v) => ({ sku: v.sku, valor: v.valor })),
    p_canal_venda: canal, p_pedido_ref: orc.codigo, p_comprador: orc.cliente_nome || null, p_user: user.email,
  });
  if (error) throw error;
  const novo = await mudarStatus(orc, "VENDIDO");
  await liberarReserva(orc);
  return novo;
}

// Página pública: RPC SECURITY DEFINER (orcamento_publico) devolve UM orçamento por slug
// exato, só ENVIADO/RESERVADO não vencido e sem o WhatsApp do cliente. A tabela não
// tem leitura anônima (evita listar todos os orçamentos).
export async function buscarOrcamentoPublico(slug) {
  const { data, error } = await supabase.rpc("orcamento_publico", { p_slug: slug });
  if (error || !data?.length) return null;
  return data[0];
}
