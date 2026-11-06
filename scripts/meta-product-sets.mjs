// meta-product-sets.mjs — cria um Product Set por macro-categoria no catálogo principal da Meta.
// Filtro: custom_label_3 = slug da macro (coluna nova do feed catalogo-meta-feed). Aditivo e idempotente:
// só cria o que falta; nunca apaga nem edita sets existentes; não toca em itens (ids/links intactos).
//
// Uso:
//   node scripts/meta-product-sets.mjs            # DRY-RUN: lista o que criaria
//   node scripts/meta-product-sets.mjs --aplicar  # cria os sets que faltam
// Env (.env.local ou process.env): META_CATALOG_TOKEN, META_CATALOG_ID, META_API_VERSION (opcional, padrão v23.0)
import { readFileSync } from "node:fs";

const env = {};
try { for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); } } catch { /* usa process.env */ }
const g = (k) => env[k] || process.env[k];
const TOKEN = g("META_CATALOG_TOKEN"), CATALOG = g("META_CATALOG_ID"), VERSAO = g("META_API_VERSION") || "v23.0";
if (!TOKEN || !CATALOG) { console.error("Faltam META_CATALOG_TOKEN / META_CATALOG_ID"); process.exit(1); }
const APLICAR = process.argv.includes("--aplicar");

// Mesmo slug de supabase/functions/_shared/catalogoMeta.ts (slugMacro).
const slugMacro = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const MACROS = ["Moda e Acessórios", "Calçados", "Beleza e Saúde", "Casa e Decoração", "Cozinha e Eletrodomésticos",
  "Eletrônicos e Informática", "Ferramentas e Construção", "Infantil, Esporte e Lazer", "Diversos"];

const base = `https://graph.facebook.com/${VERSAO}`;
const headers = { Authorization: `Bearer ${TOKEN}` };

async function graph(url, init) {
  const r = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meta ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 300)}`);
  return j;
}

async function listarSets() {
  const out = []; let url = `${base}/${CATALOG}/product_sets?fields=id,name,filter&limit=100`;
  while (url) { const j = await graph(url); out.push(...(j.data || [])); url = j.paging?.next || null; }
  return out;
}

const existentes = await listarSets();
const filtroDe = (slug) => JSON.stringify({ custom_label_3: { eq: slug } });
const jaTem = (m) => existentes.some((s) => s.name === m || (typeof s.filter === "string" ? s.filter : JSON.stringify(s.filter)) === filtroDe(slugMacro(m)));

console.log(`${existentes.length} product sets já existem no catálogo ${CATALOG}.`);
for (const m of MACROS) {
  const slug = slugMacro(m);
  if (jaTem(m)) { console.log(`= já existe: ${m} (${slug})`); continue; }
  if (!APLICAR) { console.log(`+ criaria: ${m} → custom_label_3 = ${slug}`); continue; }
  const j = await graph(`${base}/${CATALOG}/product_sets`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name: m, filter: filtroDe(slug) }),
  });
  console.log(`✔ criado: ${m} (${slug}) id=${j.id}`);
}
if (!APLICAR) console.log("\nDRY-RUN: nada foi criado. Use --aplicar depois que o feed novo já estiver publicado e a Meta tiver lido o custom_label_3.");
