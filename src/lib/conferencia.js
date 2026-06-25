// Conferência de produtos: definir/reatribuir lote (com rename de SKU) e
// inventário físico (marcar item como conferido). Lógica de dados isolada dos
// componentes, espelhando o padrão de retry-em-colisão de NewItem.jsx.
import { supabase } from "./supabase";
import { buildSku } from "./model";
import { classeAutomatica } from "./classificacao";
import { copiarFotos } from "./fotos";

// Próximo sequencial dentro de um lote real (parseia o sufixo do maior SKU).
async function proximoSeqLote(lote) {
  const { data } = await supabase
    .from("itens").select("sku").eq("lote", lote).order("sku", { ascending: false }).limit(1);
  if (data && data.length) return (parseInt(data[0].sku.split("-").pop(), 10) || 0) + 1;
  return 1;
}

// Garante que o lote exista em `lotes` antes de associar itens (FK itens_lote_fkey).
export async function garantirLote(lote, referencia) {
  const { error } = await supabase
    .from("lotes").insert({ lote: Number(lote), referencia: referencia?.trim() || null });
  if (error && error.code !== "23505") throw error; // 23505 = já existe
}

// Atribui (ou troca) o lote de um item, regenerando o SKU para NOG-<lote>-<seq>.
// As FKs fotos/publicacoes têm ON UPDATE CASCADE; eventos não tem FK e é
// atualizado à mão para manter o histórico ligado ao novo SKU. Retorna o novo SKU.
export async function atribuirLote(skuAntigo, lote, user) {
  const loteN = Number(lote);
  let seq = await proximoSeqLote(loteN);
  let novoSku = buildSku(loteN, seq);
  let ok = false, lastErr = null;
  for (let i = 0; i < 6; i++) {
    const { error } = await supabase
      .from("itens").update({ sku: novoSku, lote: loteN, upd_by: user.email }).eq("sku", skuAntigo);
    if (!error) { ok = true; break; }
    lastErr = error;
    if (error.code === "23505") { seq++; novoSku = buildSku(loteN, seq); } // colisão de SKU
    else break;
  }
  if (!ok) throw lastErr || new Error("Falha ao atribuir o lote.");

  await supabase.from("eventos").update({ sku: novoSku }).eq("sku", skuAntigo);
  await supabase.from("eventos").insert({
    sku: novoSku, acao: "lote:atribuido", detalhe: `${skuAntigo} → ${novoSku}`, usuario: user.email,
  });
  return novoSku;
}

// Marca um item como conferido fisicamente (carimbo de quem/quando) + auditoria.
export async function marcarConferido(sku, user) {
  const { error } = await supabase
    .from("itens")
    .update({ conferido_em: new Date().toISOString(), conferido_por: user.email })
    .eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku, acao: "conferido", usuario: user.email });
}

// Limpa a marcação de conferência (reiniciar a conferência de um lote).
export async function limparConferencia(sku) {
  const { error } = await supabase
    .from("itens").update({ conferido_em: null, conferido_por: null }).eq("sku", sku);
  if (error) throw error;
}

// Define a categoria (grupo) de um item; opcionalmente preenche a classe quando
// passada (usado na categorização em massa para preencher classe ainda vazia).
// Propaga a categoria para as unidades-irmãs do desmembramento (best-effort).
export async function definirCategoria(sku, grupo, user, classe) {
  const patch = { grupo: grupo || null, upd_by: user.email };
  if (classe) patch.classe = classe;
  const { error } = await supabase.from("itens").update(patch).eq("sku", sku);
  if (error) throw error;
  if (grupo) { try { await propagarCategoriaIrmaos(sku, user); } catch { /* best-effort */ } }
}

// Campos de identidade que definem as unidades-irmãs de um desmembramento (espelha
// CAMPOS_COPIA + ID_FIELDS do backfill de fotos): mesmo lote, mesma identidade de
// produto e sem nº de série (assinatura de cópia de split).
const IRMAOS_ID = ["produto", "marca", "modelo", "gtin", "cor", "estado"];

// Propaga a categoria (grupo) e a classe de um item já categorizado para suas
// unidades-irmãs do desmembramento que ainda estão SEM categoria (grupo nulo). Só
// preenche lacunas — nunca sobrescreve uma categoria definida de propósito. Retorna
// o nº de irmãs atualizadas. Resolve o caso de desmembrar ANTES de categorizar.
export async function propagarCategoriaIrmaos(sku, user) {
  const sel = `sku, lote, num_serie, grupo, classe, ${IRMAOS_ID.join(", ")}`;
  const { data: orig } = await supabase.from("itens").select(sel).eq("sku", sku).maybeSingle();
  if (!orig || orig.lote == null || !orig.grupo) return 0;
  const { data: cands } = await supabase
    .from("itens").select(sel)
    .eq("lote", orig.lote).is("grupo", null).is("num_serie", null).neq("sku", orig.sku);
  const igual = (a, b) => (a ?? null) === (b ?? null);
  const skus = (cands || [])
    .filter((c) => IRMAOS_ID.every((k) => igual(c[k], orig[k])))
    .map((c) => c.sku);
  if (!skus.length) return 0;
  const patch = { grupo: orig.grupo, upd_by: user.email };
  if (orig.classe) patch.classe = orig.classe;
  for (let i = 0; i < skus.length; i += 200) {
    const { error } = await supabase.from("itens").update(patch).in("sku", skus.slice(i, i + 200));
    if (error) throw error;
  }
  return skus.length;
}

// Campos que a IA (enriquecer-produto) preenche e que devem propagar para as irmãs.
const CAMPOS_IA = [
  "preco_ref_novo", "preco_ref_usado", "preco_ref_confianca", "preco_ref_fonte",
  "titulo_anuncio", "descricao_anuncio", "marca", "modelo", "grupo", "ncm", "voltagem", "cor",
  "comprimento_cm", "largura_cm", "altura_cm", "peso_real_kg", "medidas_fonte",
  "bullet_points", "palavras_chave", "ficha_tecnica",
];
const vazioCampo = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

// Propaga o enriquecimento da IA de um item para suas unidades-irmãs do desmembramento,
// preenchendo SÓ os campos vazios de cada irmã (nunca sobrescreve dado humano). Mesma
// identidade (IRMAOS_ID), mesmo lote, sem nº de série. Retorna o nº de irmãs atualizadas.
export async function propagarEnriquecimentoIrmaos(sku, user) {
  const sel = [...new Set(["sku", "lote", "num_serie", ...IRMAOS_ID, ...CAMPOS_IA])].join(", ");
  const { data: orig } = await supabase.from("itens").select(sel).eq("sku", sku).maybeSingle();
  if (!orig || orig.lote == null) return 0;
  const { data: cands } = await supabase
    .from("itens").select(sel)
    .eq("lote", orig.lote).is("num_serie", null).neq("sku", orig.sku);
  const igual = (a, b) => (a ?? null) === (b ?? null);
  const irmas = (cands || []).filter((c) => IRMAOS_ID.every((k) => igual(c[k], orig[k])));
  let n = 0;
  for (const c of irmas) {
    const patch = {};
    for (const campo of CAMPOS_IA) {
      if (!vazioCampo(orig[campo]) && vazioCampo(c[campo])) patch[campo] = orig[campo];
    }
    if (!Object.keys(patch).length) continue;
    patch.upd_by = user.email;
    const { error } = await supabase.from("itens").update(patch).eq("sku", c.sku);
    if (!error) n++;
  }
  return n;
}

// Move um item para outra etapa (status) com rastreabilidade. Registra um evento
// "status:<novo>" com detalhe "de <etapa anterior>" para aparecer no Registro.
// Usado tanto no avanço/retorno individual quanto no mover-etapa em massa.
export async function moverEtapa(sku, novoStatus, user, deStatusLabel) {
  // Carimba as datas de pós-venda mesmo no avanço em massa (sem exigir os detalhes
  // manuais aqui). entregue_em a cada entrega; vendido_em só onde ainda não houver
  // (update guardado por .is(null), idempotente em re-movimentações).
  const patch = { status: novoStatus, upd_by: user.email };
  if (novoStatus === "ENTREGUE") patch.entregue_em = new Date().toISOString();
  const { error } = await supabase
    .from("itens").update(patch).eq("sku", sku);
  if (error) throw error;
  if (novoStatus === "VENDIDO")
    await supabase.from("itens")
      .update({ vendido_em: new Date().toISOString() }).eq("sku", sku).is("vendido_em", null);
  await supabase.from("eventos").insert({
    sku, acao: "status:" + novoStatus,
    detalhe: deStatusLabel ? `de ${deStatusLabel}` : null,
    usuario: user.email,
  });
}

// Política de teste por risco/valor: testar 100% é inviável por logística. O teste
// só é OBRIGATÓRIO para itens de risco ALTO (eletrônicos complexos/bateria) ou de
// valor de referência acima do limite (params.config.testeValorMin). Os demais podem
// seguir como "Usado sem teste" (fator de preço conservador em pricing.js).
export function testeObrigatorio(it, params) {
  const g = params?.grupos?.[it?.grupo];
  if (g?.nivelRisco === "ALTO") return true;
  const limite = params?.config?.testeValorMin ?? 150;
  const valorRef = Number(it?.preco_ref_novo ?? it?.preco_novo_est ?? g?.ancoraNovo ?? 0);
  return valorRef >= limite;
}

// Registra que o item seguiu sem teste por política (rastreabilidade no Registro).
export async function registrarSemTeste(sku, user) {
  await supabase.from("eventos").insert({
    sku, acao: "teste:dispensado", detalhe: "por política de risco/valor", usuario: user.email,
  });
}

// Próximo sequencial considerando lote real ou itens sem lote (prefixo SL).
async function proximoSeq(lote) {
  if (lote == null || lote === "") {
    const { data } = await supabase
      .from("itens").select("sku").like("sku", "NOG-SL-%").order("sku", { ascending: false }).limit(1);
    if (data && data.length) return (parseInt(data[0].sku.split("-").pop(), 10) || 0) + 1;
    return 1;
  }
  return proximoSeqLote(Number(lote));
}

// Campos do produto copiados para cada nova unidade (sem identidade única/venda).
const CAMPOS_COPIA = [
  "lote", "produto", "grupo", "classe", "marca", "modelo", "gtin", "ncm", "voltagem", "cor",
  "comprimento_cm", "largura_cm", "altura_cm", "peso_real_kg", "peso_kg",
  "preco_novo_est", "preco_sugerido", "preco_min", "preco_ideal",
  "preco_ref_novo", "preco_ref_usado", "preco_ref_fonte", "preco_ref_confianca",
  "destino", "canal_principal", "condicao_anuncio", "titulo_anuncio", "descricao_anuncio",
  "local_fisico", "caixa_num", "status",
  "estado", "testado", "funciona", "avaria", "acessorios_ok", "caixa_original",
];

// Desmembra um item em `total` unidades individuais (1 SKU cada). O item original é a
// unidade 1; cria total-1 novos itens no mesmo lote copiando os dados do produto (sem
// nº de série nem dados de venda). As fotos do original são REPLICADAS para cada nova
// unidade (cópia física no storage). Registra auditoria. Retorna os novos itens.
export async function desmembrarItem(item, total, user) {
  const extras = Math.max(0, Math.floor(Number(total) || 0) - 1);
  if (!extras) return [];
  const lote = item.lote ?? null;

  const base = {};
  for (const k of CAMPOS_COPIA) if (item[k] !== undefined) base[k] = item[k];
  base.quantidade = 1;
  base.anuncio_feito = false;
  base.upd_by = user.email;

  const novos = [];
  for (let i = 0; i < extras; i++) {
    let seq = await proximoSeq(lote);
    let inserido = null, lastErr = null;
    for (let tent = 0; tent < 6; tent++) {
      const { data, error } = await supabase
        .from("itens").insert({ ...base, sku: buildSku(lote, seq) }).select().single();
      if (!error) { inserido = data; break; }
      lastErr = error;
      if (error.code === "23505") { seq++; continue; } // colisão de SKU
      break;
    }
    if (!inserido) throw lastErr || new Error("Falha ao criar unidade.");
    // Replica as fotos do original para a nova unidade (best-effort: falha na cópia
    // não derruba o desmembramento, pois o item já foi criado).
    try { await copiarFotos(item.sku, inserido.sku); } catch { /* cópia best-effort */ }
    novos.push(inserido);
  }

  // Registra os SKUs criados no detalhe para rastreabilidade (operações futuras).
  await supabase.from("eventos").insert({
    sku: item.sku, acao: "desmembrado",
    detalhe: `+${extras} unidade(s): ${novos.map((n) => n.sku).join(", ")}`,
    usuario: user.email,
  });
  return novos;
}

// ───────────────────────── Classificação em massa (backfill) ─────────────────────────
// Itens parados em "A catalogar" (e quaisquer outros) podem ficar sem `classe`. Estas
// funções dão classe a todos eles pelo sinal categoria → valor → C (lib/classificacao.js).

// Quantos itens estão sem classe (para mostrar no botão de backfill).
export async function contarSemClasse() {
  const { count, error } = await supabase
    .from("itens").select("sku", { count: "exact", head: true }).is("classe", null);
  if (error) throw error;
  return count || 0;
}

// Classifica TODOS os itens sem classe. Agrupa por classe calculada e aplica em lote
// (.in()). Auditoria best-effort. Retorna { total, porClasse }.
export async function classificarSemClasse(params, user) {
  const PAGE = 1000;
  let itens = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("itens")
      .select("sku, grupo, preco_ideal, preco_sugerido, preco_ref_usado, preco_ref_novo, preco_novo_est")
      .is("classe", null)
      .order("sku")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    itens = itens.concat(data);
    if (data.length < PAGE) break;
  }
  if (!itens.length) return { total: 0, porClasse: {} };

  // Agrupa os SKUs pela classe calculada.
  const porClasseSkus = {};
  const porClasse = {};
  for (const it of itens) {
    const { classe } = classeAutomatica(it, params);
    (porClasseSkus[classe] = porClasseSkus[classe] || []).push(it.sku);
    porClasse[classe] = (porClasse[classe] || 0) + 1;
  }

  // Atualiza em fatias por classe.
  for (const [classe, skus] of Object.entries(porClasseSkus)) {
    for (let i = 0; i < skus.length; i += 200) {
      const slice = skus.slice(i, i + 200);
      const { error } = await supabase
        .from("itens").update({ classe, upd_by: user.email }).in("sku", slice);
      if (error) throw error;
    }
  }

  // Auditoria best-effort (um evento por item, em inserts fatiados).
  try {
    const eventos = [];
    for (const [classe, skus] of Object.entries(porClasseSkus))
      for (const sku of skus)
        eventos.push({ sku, acao: "classe:backfill", detalhe: classe, usuario: user.email });
    for (let i = 0; i < eventos.length; i += 500)
      await supabase.from("eventos").insert(eventos.slice(i, i + 500));
  } catch { /* auditoria best-effort */ }

  return { total: itens.length, porClasse };
}
