// Edge Function: pesquisa-preco-web
// Pesquisa o preço de mercado BR de UM item na web (Claude + ferramenta web_search, restrita
// a marketplaces), calcula a mediana dos anúncios e grava a amostra em pesquisa_preco_web.
// NÃO altera itens: devolve a sugestão; quem aplica é o operador.
//
// Só pesquisa itens PRONTOS PARA PUBLICAÇÃO (cadastro completo) para não gastar busca em
// item com informação incompleta. Cache de 7 dias por SKU (force=true ignora).
//
// Entrada: { sku: string, force?: boolean }
// Saída:   { ok, pronto, faltando[], cache, sugestao?: { mediana, n, min, max, confianca,
//            condicao, anuncios[], obs } }
//
// Secrets: ANTHROPIC_API_KEY (obrigatório); ANTHROPIC_PRECO_MODEL (opcional, default claude-haiku-5-5).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const MODEL = Deno.env.get("ANTHROPIC_PRECO_MODEL") || "claude-haiku-5-5";
const DOMINIOS = ["mercadolivre.com.br", "amazon.com.br", "magazineluiza.com.br", "shopee.com.br"];
const CACHE_DIAS = 7;

// "Pronto para publicação" = cadastro completo o bastante para a pesquisa achar o MESMO produto.
function faltando(it: any): string[] {
  const f: string[] = [];
  if (!it.produto || String(it.produto).trim().length < 5) f.push("nome do produto");
  if (!it.estado) f.push("estado (novo/usado)");
  // sem marca é comum (genéricos, livros): o mínimo para achar o MESMO produto é modelo ou GTIN.
  if (!String(it.modelo ?? "").trim() && !String(it.gtin ?? "").trim()) f.push("modelo (ou GTIN)");
  if (!it.grupo || /n[ãa]o classificado/i.test(it.grupo)) f.push("categoria");
  if (it.foto_feita !== true) f.push("foto");
  if (!it.status || it.status === "A_CATALOGAR") f.push("triagem/catalogação");
  return f;
}

// Devolve também os preços cortados como outliers, para a tela explicar o cálculo.
function medianaRobusta(precos: number[]) {
  const v = precos.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p: number) => {
    const k = (v.length - 1) * p, f = Math.floor(k);
    return v[f] + (v[Math.min(f + 1, v.length - 1)] - v[f]) * (k - f);
  };
  let w = v;
  let limites: { inf: number; sup: number } | null = null;
  if (v.length >= 4) {
    const i = q(0.75) - q(0.25);
    limites = { inf: q(0.25) - 1.5 * i, sup: q(0.75) + 1.5 * i };
    w = v.filter((x) => x >= limites!.inf && x <= limites!.sup);
  }
  const m = Math.floor(w.length / 2);
  return {
    mediana: w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2, n: w.length, min: w[0], max: w[w.length - 1],
    outliers: v.filter((x) => !w.includes(x)), limites,
  };
}

// Regra validada no teste de 12 itens: ≥3 anúncios e dispersão contida para confiar.
function confianca(est: { n: number; min: number; max: number; mediana: number } | null) {
  if (!est || est.n === 0) return "NENHUMA";
  if (est.n < 3) return "BAIXA";
  const disp = (est.max - est.min) / est.mediana;
  if (est.n >= 4 && disp <= 0.5) return "ALTA";
  return disp <= 1 ? "MEDIA" : "BAIXA";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Auth idêntica à enriquecer-produto: JWT de usuário do app OU chave de serviço.
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    let userId: string | null = null;
    let autorizado = false;
    const { data: u } = await admin.auth.getUser(jwt);
    if (u?.user) { autorizado = true; userId = u.user.id; }
    if (!autorizado && jwt) {
      try {
        const probe = createClient(Deno.env.get("SUPABASE_URL")!, jwt, { auth: { persistSession: false } });
        const { error: pErr } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
        if (!pErr) autorizado = true;
      } catch { /* não é chave de serviço */ }
    }
    if (!autorizado) return json({ error: "não autenticado" }, 401);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY não configurada" }, 500);

    const { sku, force } = (await req.json()) ?? {};
    if (!sku || typeof sku !== "string") return json({ error: "informe 'sku'" }, 400);

    const { data: it, error: eIt } = await admin
      .from("itens")
      .select("sku,produto,marca,modelo,estado,grupo,status,foto_feita,voltagem,cor,gtin,tamanho,ncm")
      .eq("sku", sku).maybeSingle();
    if (eIt) return json({ error: eIt.message }, 500);
    if (!it) return json({ error: "sku não encontrado" }, 404);

    const falta = faltando(it);
    if (falta.length) return json({ ok: true, pronto: false, faltando: falta });

    if (!force) {
      const desde = new Date(Date.now() - CACHE_DIAS * 86400_000).toISOString();
      const { data: c } = await admin.from("pesquisa_preco_web").select("*")
        .eq("sku", sku).gte("created_at", desde).order("created_at", { ascending: false }).limit(1);
      if (c?.[0]) {
        const r = c[0];
        return json({
          ok: true, pronto: true, cache: true,
          sugestao: { mediana: r.mediana, n: r.n, min: r.preco_min, max: r.preco_max, confianca: r.confianca,
                      condicao: r.condicao, anuncios: r.anuncios, descartados: r.descartados ?? [], obs: r.obs,
                      regra: { dominios: DOMINIOS, modelo: r.modelo_ia, pesquisado_em: r.created_at } },
        });
      }
    }

    const condicao = /novo/i.test(it.estado) ? "NOVO" : "USADO";
    const prompt =
      `Pesquise o preço de venda atual no Brasil do produto abaixo e devolva SOMENTE um JSON.\n` +
      `Produto: ${it.produto}${it.marca ? ` | marca: ${it.marca}` : ""}${it.modelo ? ` | modelo: ${it.modelo}` : ""}` +
      `${it.voltagem ? ` | voltagem: ${it.voltagem}` : ""}${it.cor ? ` | cor: ${it.cor}` : ""}${it.tamanho ? ` | tamanho: ${it.tamanho}` : ""}` +
      `${it.gtin ? ` | GTIN: ${it.gtin}` : ""}${it.ncm ? ` | NCM: ${it.ncm}` : ""}\n` +
      `Condição desejada: ${condicao === "NOVO" ? "NOVO" : "USADO/seminovo"}\n\n` +
      `Regras: use apenas anúncios reais dos resultados da busca, do MESMO modelo/edição e condição ` +
      `(se a edição for ambígua, diga em "obs"). Exclua anúncios internacionais e variantes/kits diferentes. ` +
      `Traga de 3 a 6 anúncios com a URL exata e o preço à vista em reais. Não invente anúncio nem preço. ` +
      `Se não achar comparáveis, devolva "anuncios": [].\n` +
      `Formato: {"anuncios":[{"titulo":"","preco":0,"url":"","loja":""}],"obs":""}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4, allowed_domains: DOMINIOS }],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.warn(`[pesquisa-preco-web] Claude HTTP ${r.status} :: ${t.slice(0, 300)}`);
      return json({ error: `Claude API HTTP ${r.status}` }, 502);
    }
    const msg = await r.json();
    const texto = (msg.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    let res: any = { anuncios: [], obs: `sem JSON na resposta (stop=${msg.stop_reason})` };
    const m = texto.match(/\{[\s\S]*\}/);
    if (m) { try { res = JSON.parse(m[0]); } catch { /* mantém o padrão */ } }

    // Só aceita anúncio com URL de um domínio permitido e preço numérico.
    const brutos: any[] = Array.isArray(res.anuncios) ? res.anuncios : [];
    const descartados: any[] = [];
    const anuncios = brutos.filter((a: any) => {
      let motivo: string | null = null;
      if (!(Number(a.preco) > 0)) motivo = "preço inválido";
      else {
        try {
          const u = new URL(a.url);
          const h = u.hostname.toLowerCase().replace(/\.$/, "");
          // só https e domínio exato ou subdomínio verdadeiro (evita evilmercadolivre.com.br)
          if (u.protocol !== "https:" || !DOMINIOS.some((d) => h === d || h.endsWith("." + d))) {
            motivo = "loja fora da lista permitida";
          }
        } catch { motivo = "URL inválida"; }
      }
      if (motivo) descartados.push({ titulo: a.titulo ?? null, preco: Number(a.preco) || null, url: a.url ?? null, motivo });
      return !motivo;
    });
    const est = medianaRobusta(anuncios.map((a: any) => Number(a.preco)));
    // Anúncios cortados por estarem fora da faixa (IQR) também entram na explicação.
    for (const a of anuncios) {
      if (est?.outliers.includes(Number(a.preco))) descartados.push({ titulo: a.titulo, preco: Number(a.preco), url: a.url, motivo: "preço fora da faixa dos demais (outlier)" });
    }
    const usados = anuncios.filter((a: any) => !est?.outliers.includes(Number(a.preco)));
    const conf = confianca(est);

    const linha = {
      sku, condicao, mediana: est?.mediana ?? null, n: est?.n ?? 0, preco_min: est?.min ?? null,
      preco_max: est?.max ?? null, confianca: conf, anuncios: usados, descartados, obs: res.obs ?? null, modelo_ia: MODEL, criado_por: userId,
    };
    const { error: eIns } = await admin.from("pesquisa_preco_web").insert(linha);
    if (eIns) console.warn(`[pesquisa-preco-web] falha ao gravar amostra: ${eIns.message}`);

    return json({
      ok: true, pronto: true, cache: false,
      sugestao: { mediana: linha.mediana, n: linha.n, min: linha.preco_min, max: linha.preco_max,
                  confianca: conf, condicao, anuncios: usados, descartados, obs: linha.obs,
                  regra: { dominios: DOMINIOS, modelo: MODEL, pesquisado_em: new Date().toISOString() } },
    });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
