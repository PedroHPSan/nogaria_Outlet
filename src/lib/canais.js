// Onde está cada peça (canais, reserva) e ações do painel. Único lugar do app que lê listing_state/reservas/jobs.
import { supabase } from "./supabase.js";

export const CANAL_ROTULO = { whatsapp: "Catálogo WhatsApp", instagram: "Instagram", amazon: "Amazon", mercadolivre: "Mercado Livre" };
export const ESTADO_ROTULO = { publicado: "No ar", pausado: "Pausado", publicando: "Publicando…", erro: "Erro", nao_publicado: "Fora do ar" };

const rpc = async (fn, args) => { const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return data; };

export async function situacaoDaPeca(sku) {
  const [ls, rs] = await Promise.all([
    supabase.from("listing_state").select("canal,estado,url_publica,ultimo_erro,pausado_motivo,sync_em,updated_at").eq("sku", sku),
    supabase.from("reservas").select("canal,origem_tipo,origem_ref,expira_em").eq("sku", sku).eq("status", "ATIVA").maybeSingle(),
  ]);
  if (ls.error) throw ls.error;
  return { canais: ls.data || [], reserva: rs.data || null };
}

export const retirarDeTodos = (sku, user) => rpc("retirar_de_todos", { p_sku: sku, p_user: user?.email ?? null });
export const painelCatalogo = () => rpc("catalogo_painel");
export const jobsComProblema = async () => [...(await rpc("jobs_listar", { p_status: "morto", p_limite: 50 })), ...(await rpc("jobs_listar", { p_status: "erro", p_limite: 50 }))];
export const reenfileirarJob = (id) => rpc("job_reenfileirar", { p_id: id });

// Tirar uma oferta do catálogo é decisão deliberada da Bárbara: fica registrada e a peça não volta a ser oferecida.
export async function excluirDoCatalogo(skus, user) {
  const linhas = skus.map((sku) => ({ sku, canal: "whatsapp", estado: "pausado", pausado_motivo: "excluido", updated_at: new Date().toISOString() }));
  const { error } = await supabase.from("listing_state").upsert(linhas, { onConflict: "sku,canal" });
  if (error) throw error;
  await supabase.from("eventos").insert(skus.map((sku) => ({ sku, acao: "catalogo:excluido", usuario: user?.email ?? null })));
}

// Interruptor por canal (N12). Desativar recusa reserva, publicação e feed; retiradas continuam.
export const CANAIS_INTERRUPTOR = ["whatsapp", "instagram", "amazon", "mercadolivre"];
export async function listarCanais() {
  const { data, error } = await supabase.from("canais").select("codigo,nome,ativo").in("codigo", CANAIS_INTERRUPTOR);
  if (error) throw error;
  return CANAIS_INTERRUPTOR.map((c) => (data || []).find((x) => x.codigo === c)).filter(Boolean);
}
export async function definirCanalAtivo(codigo, ativo, user) {
  const { error } = await supabase.from("canais").update({ ativo }).eq("codigo", codigo);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku: null, acao: `canal:${codigo} ${ativo ? "ativado" : "desativado"}`, usuario: user?.email ?? null }).then(() => {}, () => {});
}
