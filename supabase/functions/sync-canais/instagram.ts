// Handlers do canal Instagram: publicar (fila aprovada), comentar VENDIDO e renovar o token.
// IG_DRY_RUN=1 (ou SYNC_DRY_RUN=1) simula: nada vai à API e o id da mídia fica "dry_<id>" (a tela mostra "simulado").
// Sem token e sem dry-run, falha de forma explícita — nunca marca como publicado sem ter publicado.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { comentar, mensagemVendido, publicarNoInstagram, renovarToken, type Pub } from "../_shared/instagram.ts";

type Ctx = { dryRun: boolean; admin: SupabaseClient; job: { id: number; tentativas: number } };
const MAX_TENTATIVAS = 5;

const simular = (ctx: Ctx) => ctx.dryRun || Deno.env.get("IG_DRY_RUN") === "1";
const versao = () => Deno.env.get("IG_API_VERSION") ?? undefined;

async function credenciais(ctx: Ctx) {
  const { data } = await ctx.admin.from("instagram_oauth").select("ig_user_id, access_token, expires_at").eq("id", 1).maybeSingle();
  if (!data?.access_token || !data.ig_user_id) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) throw new Error("token do Instagram expirado: reconecte a conta");
  return { userId: data.ig_user_id as string, token: data.access_token as string };
}

export async function publicarInstagram(payload: Record<string, unknown>, ctx: Ctx) {
  const id = String(payload.publicacao_id);
  // claim: só aprovado (ou retomada de 'publicando'); cancelada/publicada/esgotada → nada a fazer
  const { data: pub } = await ctx.admin.from("publicacoes").update({ status: "publicando", atualizado_em: new Date().toISOString() })
    .eq("id", id).in("status", ["aprovado", "publicando"]).select("id, tipo, skus, payload, container_id").maybeSingle();
  if (!pub) return;
  try {
    for (const sku of pub.skus as string[]) {
      const { data: livre } = await ctx.admin.rpc("item_disponivel", { p_sku: sku });
      if (!livre) {
        await ctx.admin.from("publicacoes").update({ status: "cancelado", erro: `${sku} ficou indisponível antes de publicar`, atualizado_em: new Date().toISOString() }).eq("id", id);
        return;
      }
    }
    let mediaId: string, permalink: string | null = null;
    if (simular(ctx)) {
      console.log(`[ig dry-run] publicaria ${pub.tipo} (${(pub.payload as Pub["payload"]).midias.length} mídia(s)) da publicação ${id}`);
      mediaId = `dry_${id}`;
    } else {
      const cred = await credenciais(ctx);
      if (!cred) throw new Error("Instagram não conectado (tabela instagram_oauth vazia)");
      const r = await publicarNoInstagram(pub as unknown as Pub, {
        ...cred, versao: versao(),
        salvarContainer: async (c) => { await ctx.admin.from("publicacoes").update({ container_id: c }).eq("id", id); },
      });
      mediaId = r.mediaId; permalink = r.permalink;
    }
    await ctx.admin.from("publicacoes").update({ status: "publicado", external_id: mediaId, publicado_em: new Date().toISOString(), erro: null, atualizado_em: new Date().toISOString() }).eq("id", id);
    const linhas = (pub.skus as string[]).map((sku) => ({
      sku, canal: "instagram", estado: "publicado", external_listing_id: mediaId, url_publica: permalink, sync_em: new Date().toISOString(), updated_at: new Date().toISOString(),
    }));
    if (linhas.length) await ctx.admin.from("listing_state").upsert(linhas, { onConflict: "sku,canal" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // última tentativa: a tela passa a mostrar "erro" com botão de reenviar; antes disso só guarda o motivo
    await ctx.admin.from("publicacoes").update({
      erro: msg.slice(0, 500), ...(ctx.job.tentativas >= MAX_TENTATIVAS ? { status: "erro" } : {}), atualizado_em: new Date().toISOString(),
    }).eq("id", id);
    throw e;
  }
}

export async function comentarVendido(payload: Record<string, unknown>, ctx: Ctx) {
  const mediaId = String(payload.media_id), sku = String(payload.sku);
  if (simular(ctx) || mediaId.startsWith("dry_")) { console.log(`[ig dry-run] comentaria em ${mediaId}: ${mensagemVendido(sku)}`); return; }
  const cred = await credenciais(ctx);
  if (!cred) throw new Error("Instagram não conectado (tabela instagram_oauth vazia)");
  await comentar(mediaId, mensagemVendido(sku), { ...cred, versao: versao() });
}

export async function renovarTokenInstagram(_payload: Record<string, unknown>, ctx: Ctx) {
  if (simular(ctx)) { console.log("[ig dry-run] renovaria o token"); return; }
  const cred = await credenciais(ctx);
  if (!cred) return; // conta ainda não conectada
  const { token, expiraEm } = await renovarToken({ ...cred });
  const { error } = await ctx.admin.from("instagram_oauth").update({ access_token: token, expires_at: expiraEm, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw new Error(error.message);
}
