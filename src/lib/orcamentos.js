// Orçamentos persistidos: criar, listar, enviar, reservar, cancelar e converter em
// venda (via registrarVenda, 1 SKU = 1 venda). Regras puras em orcamentosCore.js.
import { supabase } from "./supabase";
import { gerarSlug } from "./catalogoPublico";
import { registrarVenda } from "./vendas";
import { EMPRESA } from "./empresa";
import {
  codigoOrcamento, proximoSeq, snapshotItens, totais, validadeEm, podeTransitar, valoresPorItem, reservaAtiva,
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

async function mudarStatus(orc, para, extra = {}) {
  if (!podeTransitar(orc.status, para)) throw new Error(`Orçamento ${orc.codigo}: ${orc.status} → ${para} não é permitido.`);
  const { data, error } = await supabase.from("orcamentos")
    .update({ status: para, atualizado_em: new Date().toISOString(), ...extra }).eq("id", orc.id).select("*").single();
  if (error) throw error;
  return data;
}

export const marcarEnviado = (orc) => mudarStatus(orc, "ENVIADO");

// Reserva os itens por 48 h. Recusa se algum já estiver reservado por OUTRO orçamento.
export async function reservarOrcamento(orc, user) {
  const skus = orc.itens.map((i) => i.sku);
  const { data: atuais, error } = await supabase.from("itens").select("sku, status, reservado_ate, reservado_por_orc").in("sku", skus);
  if (error) throw error;
  const conflito = (atuais || []).filter((i) => reservaAtiva(i) && i.reservado_por_orc !== orc.codigo);
  if (conflito.length) throw new Error(`Já reservado em outro orçamento: ${conflito.map((i) => i.sku).join(", ")}`);
  const indisponiveis = (atuais || []).filter((i) => ["VENDIDO", "ENTREGUE", "DESCARTE"].includes(i.status));
  if (indisponiveis.length) throw new Error(`Fora de estoque: ${indisponiveis.map((i) => i.sku).join(", ")}`);
  const ate = validadeEm();
  const { error: e2 } = await supabase.from("itens").update({ reservado_ate: ate, reservado_por_orc: orc.codigo, upd_by: user.email }).in("sku", skus);
  if (e2) throw e2;
  return mudarStatus(orc, "RESERVADO", { validade: ate });
}

async function liberarReserva(orc) {
  await supabase.from("itens").update({ reservado_ate: null, reservado_por_orc: null }).eq("reservado_por_orc", orc.codigo);
}

export async function cancelarOrcamento(orc) {
  const novo = await mudarStatus(orc, "CANCELADO");
  await liberarReserva(orc);
  return novo;
}

// Converte em venda: 1 registrarVenda por SKU com o valor já com desconto rateado.
export async function confirmarVenda(orc, user, { canal = "B2C / Venda direta" } = {}) {
  if (!podeTransitar(orc.status, "VENDIDO")) throw new Error(`Orçamento ${orc.codigo} está ${orc.status}.`);
  // Trava contra revenda: outro orçamento (ou venda avulsa) pode ter levado o item antes.
  const { data: atuais, error: eSel } = await supabase.from("itens").select("sku, status").in("sku", orc.itens.map((i) => i.sku));
  if (eSel) throw eSel;
  const jaVendidos = (atuais || []).filter((i) => ["VENDIDO", "ENTREGUE", "DESCARTE"].includes(i.status));
  if (jaVendidos.length) throw new Error(`Já vendido/fora de estoque: ${jaVendidos.map((i) => i.sku).join(", ")}. Cancele ou ajuste o orçamento.`);
  const valores = valoresPorItem(orc.itens, orc.desconto_pct);
  const falhas = [];
  for (const v of valores) {
    try {
      await registrarVenda(v.sku, { valor_vendido: v.valor, canal_venda: canal, comprador: orc.cliente_nome, pedido_ref: orc.codigo }, user);
    } catch (e) { falhas.push(`${v.sku}: ${e.message || e}`); }
  }
  if (falhas.length) throw new Error(`Venda parcial — falhou: ${falhas.join("; ")}`);
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
