// Edge Function: precos-mercado
// ATENÇÃO: temporariamente DESLIGADA da UI — o Mercado Livre desativou a pesquisa
// de preços, então o app não chama mais esta função (ver src/components/PricingCard.jsx).
// O código é mantido aqui para ser religado quando o ML reabrir a pesquisa de preços.
//
// Busca o preço de referência de um produto no Mercado Livre (Brasil/MLB).
// Entradas: { sku?, gtin?, produto, grupo?, aplicar? }
// Saída:   { confianca, preco_ref_novo, preco_ref_usado, fonte, amostra, candidatos[] }
// Se aplicar=true e sku presente, grava preco_ref_* no item.
//
// Secrets necessários (supabase secrets set ...): ML_CLIENT_ID, ML_CLIENT_SECRET
// Pré-requisito: linha em ml_oauth com refresh_token válido (ver scripts/ml_oauth_setup.md).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
 
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
 
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
 
// Renova o access_token do ML quando necessário; persiste o refresh_token rotacionado.
async function getAccessToken(): Promise<string> {
  const { data: row, error } = await admin.from("ml_oauth").select("*").eq("id", 1).single();
  if (error || !row) throw new Error("ml_oauth não configurado — rode scripts/ml_oauth_setup.md");
  const now = Date.now();
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() > now + 60_000) {
    return row.access_token;
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: Deno.env.get("ML_CLIENT_ID")!,
    client_secret: Deno.env.get("ML_CLIENT_SECRET")!,
    refresh_token: row.refresh_token,
  });
  const r = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Falha ao renovar token ML: " + JSON.stringify(j));
  const expires_at = new Date(now + (j.expires_in ?? 21600) * 1000).toISOString();
  await admin.from("ml_oauth").update({
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? row.refresh_token,
    expires_at, updated_at: new Date().toISOString(),
  }).eq("id", 1);
  return j.access_token;
}
 
async function searchML(token: string, q: string) {
  const url = `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(q)}&limit=20`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!r.ok) {
    // Captura o corpo da resposta do ML para diagnóstico (ex.: 403 do endpoint de busca restrito).
    const body = await r.text().catch(() => "");
    const err = new Error(`ML search HTTP ${r.status}: ${body.slice(0, 500)}`) as Error & {
      status?: number; ml_body?: string;
    };
    err.status = r.status;
    err.ml_body = body;
    throw err;
  }
  const j = await r.json();
  return (j.results ?? []) as any[];
}
 
// Âncora: menor preço novo confiável (descarta 1 outlier baixo se houver amostra).
export function calcularAncora(results: any[]) {
  const novos = results.filter((x) => x.condition === "new" && x.price > 0).map((x) => x.price).sort((a, b) => a - b);
  const usados = results.filter((x) => x.condition === "used" && x.price > 0).map((x) => x.price).sort((a, b) => a - b);
  const menorNovo = novos.length >= 4 ? novos[1] : (novos[0] ?? null);
  const mediana = novos.length ? novos[Math.floor(novos.length / 2)] : null;
  const menorUsado = usados.length ? (usados.length >= 4 ? usados[1] : usados[0]) : null;
  return { menorNovo, mediana, menorUsado, nNovos: novos.length, nUsados: usados.length };
}
 
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // hoisted para o catch poder registrar o estado INDISPONIVEL no item.
  let sku: string | undefined, aplicar: boolean | undefined;
  try {
    // valida o chamador (JWT de usuário autenticado do app)
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: "não autenticado" }, 401);

    const body = await req.json();
    sku = body.sku; aplicar = body.aplicar;
    const { gtin, produto, grupo } = body;
    if (!gtin && !produto) return json({ error: "informe gtin ou produto" }, 400);

    const token = await getAccessToken();
    const q = gtin || produto;
    let results = await searchML(token, q);
    let fonte = gtin ? "ML:gtin" : "ML:texto";
    // fallback: gtin sem resultado -> tenta pelo texto
    if (gtin && !results.length && produto) {
      results = await searchML(token, produto);
      fonte = "ML:texto(fallback)";
    }
 
    const a = calcularAncora(results);
    const confianca = (gtin && results.length && a.nNovos) ? "ALTA" : (a.nNovos >= 3 ? "MEDIA" : "BAIXA");
    const candidatos = results.slice(0, 5).map((x) => ({
      titulo: x.title, preco: x.price, condicao: x.condition, permalink: x.permalink, thumbnail: x.thumbnail,
    }));
 
    const out = {
      confianca,
      preco_ref_novo: a.menorNovo,
      preco_ref_usado: a.menorUsado,
      fonte,
      amostra: { n_novos: a.nNovos, n_usados: a.nUsados, menor_novo: a.menorNovo, mediana_novo: a.mediana },
      candidatos,
    };
 
    if (aplicar && sku && a.menorNovo) {
      await admin.from("itens").update({
        preco_ref_novo: a.menorNovo,
        preco_ref_usado: a.menorUsado,
        preco_ref_fonte: fonte,
        preco_ref_confianca: confianca,
      }).eq("sku", sku);
    }
    return json(out);
  } catch (e: any) {
    // Fonte (Mercado Livre) indisponível: degrada com a forma esperada pela UI,
    // mantendo um campo `erro_fonte` com o status e o corpo do ML para diagnóstico.
    if (typeof e?.status === "number") {
      // 403 = o app ainda não tem acesso liberado aos dados de preço do ML.
      const pendenteLiberacao = e.status === 403;
      const mensagem_ui = pendenteLiberacao
        ? "Referência de preço do Mercado Livre pendente de liberação. Usando âncora do grupo até o app ser aprovado no Mercado Livre."
        : `Fonte de preço do Mercado Livre indisponível no momento (HTTP ${e.status}).`;
      // log de servidor para auditoria (não expõe token nem secret).
      console.warn(`[precos-mercado] fonte ML indisponível status=${e.status} sku=${sku ?? "-"} :: ${String(e.ml_body ?? "").slice(0, 200)}`);
      // registra o estado no item para a UI sinalizar a pendência.
      if (aplicar && sku) {
        await admin.from("itens").update({
          preco_ref_fonte: "ML:indisponivel",
          preco_ref_confianca: "INDISPONIVEL",
        }).eq("sku", sku);
      }
      return json({
        confianca: "INDISPONIVEL",
        preco_ref_novo: null,
        preco_ref_usado: null,
        fonte: "ML:indisponivel",
        mensagem_ui,
        amostra: { n_novos: 0, n_usados: 0, menor_novo: null, mediana_novo: null },
        candidatos: [],
        erro_fonte: {
          provedor: "mercado_livre",
          status: e.status,
          pendente_liberacao: pendenteLiberacao,
          mensagem: pendenteLiberacao
            ? "Busca/preço do Mercado Livre bloqueado (403). App pendente de liberação de acesso a dados de preço no DevCenter do ML."
            : `Mercado Livre retornou HTTP ${e.status}.`,
          detalhe: String(e.ml_body ?? "").slice(0, 500),
        },
      });
    }
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
 
