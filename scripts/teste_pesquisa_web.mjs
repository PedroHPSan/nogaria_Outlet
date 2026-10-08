// teste_pesquisa_web.mjs — TESTE SOMENTE LEITURA: compara o preço que a busca na web da
// Anthropic acha (mediana de anúncios com URL) com o preco_ideal já definido no sistema.
// NÃO grava nada em itens. Saída: tabela no terminal + scripts/out/teste_pesquisa_web.json
//
// Uso (ANTHROPIC_API_KEY vem do ambiente — não está no .env.local):
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/teste_pesquisa_web.mjs
//   ... --skus NOG-007-013,NOG-001-046   # outra lista de SKUs
//   ... --model claude-sonnet-4-6        # outro modelo (default: claude-haiku-5-5)
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch { /* usa process.env */ }
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("Defina ANTHROPIC_API_KEY no ambiente."); process.exit(1); }
const URL_ = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SECRET = env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !SECRET) { console.error("Faltam VITE_SUPABASE_URL / SUPABASE_SECRET_KEY no .env.local"); process.exit(1); }

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MODEL = arg("--model", "claude-haiku-5-5");
const SKUS = arg("--skus", [
  "NOG-007-013", "NOG-007-004", "NOG-007-007", "NOG-001-046", "NOG-111-085", "NOG-001-191",
  "NOG-100-015", "NOG-042-004", "NOG-001-077", "NOG-116-107", "NOG-105-006", "NOG-122-004",
].join(",")).split(",");

const supabase = createClient(URL_, SECRET, { auth: { persistSession: false } });
const { data: itens, error } = await supabase
  .from("itens")
  .select("sku,produto,marca,modelo,estado,preco_ideal,upd_by")
  .in("sku", SKUS);
if (error) { console.error(error.message); process.exit(1); }

const DOMINIOS = ["mercadolivre.com.br", "produto.mercadolivre.com.br", "amazon.com.br", "magazineluiza.com.br", "shopee.com.br"];

async function pesquisar(it) {
  const novo = !it.estado || /novo/i.test(it.estado);
  const prompt =
    `Pesquise o preço de venda atual no Brasil do produto abaixo e devolva SOMENTE um JSON.\n` +
    `Produto: ${it.produto}${it.marca ? ` | marca: ${it.marca}` : ""}${it.modelo ? ` | modelo: ${it.modelo}` : ""}\n` +
    `Condição desejada: ${novo ? "NOVO" : "USADO/seminovo"}\n\n` +
    `Regras: use apenas anúncios reais dos resultados da busca, do MESMO modelo/edição e condição ` +
    `(se a edição for ambígua, diga em "obs"). Traga de 3 a 6 anúncios com a URL exata e o preço à vista em reais. ` +
    `Não invente anúncio nem preço. Se não achar comparáveis, devolva "anuncios": [].\n` +
    `Formato: {"anuncios":[{"titulo":"","preco":0,"url":"","loja":""}],"obs":""}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json",
      ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4, allowed_domains: DOMINIOS }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  const texto = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) {
    const tipos = (j.content || []).map((b) => b.type).join(",");
    return { anuncios: [], obs: `sem JSON na resposta | stop=${j.stop_reason} blocos=[${tipos}] texto="${texto.slice(0, 300)}"` };
  }
  try { return JSON.parse(m[0]); } catch { return { anuncios: [], obs: "JSON inválido" }; }
}

// mediana após cortar outliers por IQR (só com ≥4 pontos; abaixo disso, mediana simples)
function medianaRobusta(precos) {
  const v = precos.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => { const k = (v.length - 1) * p, f = Math.floor(k); return v[f] + (v[Math.min(f + 1, v.length - 1)] - v[f]) * (k - f); };
  let w = v;
  if (v.length >= 4) { const i = q(0.75) - q(0.25); w = v.filter((x) => x >= q(0.25) - 1.5 * i && x <= q(0.75) + 1.5 * i); }
  const mid = Math.floor(w.length / 2);
  return { mediana: w.length % 2 ? w[mid] : (w[mid - 1] + w[mid]) / 2, n: w.length, min: w[0], max: w[w.length - 1] };
}

const saida = [];
for (const it of itens) {
  try {
    const res = await pesquisar(it);
    const est = medianaRobusta((res.anuncios || []).map((a) => Number(a.preco)));
    const ideal = it.preco_ideal != null ? Number(it.preco_ideal) : null;
    const razao = est && ideal ? ideal / est.mediana : null;
    saida.push({ sku: it.sku, produto: it.produto, preco_ideal: ideal, ...est, razao, obs: res.obs, anuncios: res.anuncios });
    console.log(
      `${it.sku.padEnd(13)} ${it.produto.slice(0, 34).padEnd(34)} ideal=${ideal ?? "—"}`.padEnd(66) +
      (est ? ` web=${est.mediana.toFixed(0)} (n=${est.n}, ${est.min.toFixed(0)}–${est.max.toFixed(0)}) ideal/web=${razao?.toFixed(2) ?? "—"}` : " web=sem comparáveis"),
    );
  } catch (e) {
    console.log(`${it.sku} ERRO: ${e.message}`);
    saida.push({ sku: it.sku, erro: e.message });
  }
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/teste_pesquisa_web.json", import.meta.url), JSON.stringify(saida, null, 2));
console.log("\nDetalhe com URLs: scripts/out/teste_pesquisa_web.json (nada foi gravado em itens)");
