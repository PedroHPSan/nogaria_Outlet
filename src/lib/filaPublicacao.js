// Fila de publicação com aprovação (Instagram hoje; demais canais entram com os épicos E3/E4).
// O app só CRIA rascunhos, aprova/agenda/cancela pelas RPCs; quem publica é o worker (Edge Function).
import { supabase } from "./supabase.js";
import { gerarCardsDivulgacao } from "./catalogoGerar.js";

export const STATUS_FILA = {
  rascunho: { rotulo: "Rascunho", cor: "bg-gray-100 text-gray-700" },
  aprovado: { rotulo: "Na fila", cor: "bg-sky-100 text-sky-700" },
  agendado: { rotulo: "Agendado", cor: "bg-indigo-100 text-indigo-700" },
  publicando: { rotulo: "Publicando…", cor: "bg-amber-100 text-amber-700" },
  publicado: { rotulo: "Publicado", cor: "bg-emerald-100 text-emerald-700" },
  erro: { rotulo: "Erro", cor: "bg-red-100 text-red-700" },
  cancelado: { rotulo: "Cancelado", cor: "bg-gray-200 text-gray-500" },
  esgotado: { rotulo: "Esgotado", cor: "bg-orange-100 text-orange-700" },
};

// "2026-11-03T10:30" digitado pelo operador é horário de Brasília (UTC-3) → ISO.
export const brasiliaParaIso = (valor) => (valor ? new Date(`${valor}:00-03:00`).toISOString() : null);
export const fmtBrasilia = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
export const simulada = (p) => String(p.external_id || "").startsWith("dry_");

// Gera os cards em JPEG, envia ao bucket público ig-media e cria o RASCUNHO na fila.
// 1 item → post (feed) ou story (um item só); 2+ itens → carrossel (capa + até 8 produtos + chamada).
export async function enviarParaFilaInstagram(itens, { formato = "feed", titulo, tema, contato, mostrarPreco, legenda }, opts = {}) {
  if (!itens?.length) throw new Error("Nenhum item para publicar.");
  if (formato === "status") throw new Error("O formato Status é do WhatsApp; escolha Feed, Story ou Quadrado.");
  if (formato === "story" && itens.length > 1) throw new Error("Story é um item por vez (a API não publica story com vários itens).");
  const arqs = await gerarCardsDivulgacao(itens, { formato, titulo, tema, contato, mostrarPreco }, opts);
  const unico = itens.length === 1;
  const midias = unico ? [arqs[1]] : arqs; // [capa, produto, chamada] → só o card do produto
  const pasta = crypto.randomUUID();
  const urls = [];
  for (const a of midias) {
    const caminho = `${pasta}/${a.nome}`;
    const { error } = await supabase.storage.from("ig-media").upload(caminho, a.blob, { contentType: "image/jpeg", cacheControl: "3600" });
    if (error) throw error;
    urls.push(supabase.storage.from("ig-media").getPublicUrl(caminho).data.publicUrl);
  }
  const tipo = unico ? (formato === "story" ? "story" : "feed") : "carrossel";
  const skus = itens.slice(0, unico ? 1 : 8).map((i) => i.sku);
  const { data, error } = await supabase.rpc("publicacao_criar", {
    p_canal: "instagram", p_tipo: tipo, p_skus: skus, p_payload: { legenda, midias: urls }, p_agendado_para: null,
  });
  if (error) throw error;
  return data;
}

export async function listarFila(limite = 100) {
  const { data, error } = await supabase.from("publicacoes").select("*").order("criado_em", { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}

const rpc = async (fn, args) => { const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return data; };
export const aprovarPublicacao = (id) => rpc("publicacao_aprovar", { p_id: id });
export const cancelarPublicacao = (id) => rpc("publicacao_cancelar", { p_id: id });
export const reenviarPublicacao = (id) => rpc("publicacao_reenfileirar", { p_id: id });
export const agendarPublicacao = (id, quando) => rpc("publicacao_agendar", { p_id: id, p_quando: quando });
