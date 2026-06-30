#!/usr/bin/env node
// Baixa as fotos do bucket `fotos-produtos` para uma pasta local, RENOMEANDO cada
// arquivo com o CÓDIGO do produto (sku) — para enviar à assessoria.
//
// Naming: 1 foto      → NOG-001-042.jpg
//         várias fotos → NOG-001-042_01.jpg, NOG-001-042_02.jpg ... (ordem asc)
//
// Lê credenciais de .env.local (não precisa exportar nada). Usa SERVICE_ROLE se
// houver (bypass RLS); senão cai na ANON_KEY.
//
// USO:
//   node scripts/baixar_fotos_assessoria.mjs                 # baixa tudo p/ ./fotos_assessoria
//   node scripts/baixar_fotos_assessoria.mjs --out ~/Desktop/fotos
//   node scripts/baixar_fotos_assessoria.mjs --sku NOG-001   # só SKUs que começam com isso
//   node scripts/baixar_fotos_assessoria.mjs --limit 20      # teste rápido (primeiros N SKUs)
//   node scripts/baixar_fotos_assessoria.mjs --dry           # só lista, não baixa

import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BUCKET = "fotos-produtos";

// ── argumentos ───────────────────────────────────────────────────────────────
const arg = (flag, def = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? true) : def;
};
const DRY = process.argv.includes("--dry");
const OUT = resolve(String(arg("--out", "fotos_assessoria")).replace(/^~/, process.env.HOME || "~"));
const SKU_PREFIX = arg("--sku", null);
const LIMIT = arg("--limit", null) ? Number(arg("--limit")) : null;

// ── credenciais (.env.local) ─────────────────────────────────────────────────
function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* .env.local opcional */ }
}
loadEnv();

const sbUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
// Prioriza a chave secreta nova (sb_secret_…); o service_role JWT legado pode
// estar desativado após a migração de chaves do Supabase.
const sbKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;
if (!sbUrl || !sbKey) {
  console.error("Faltam VITE_SUPABASE_URL e/ou uma chave (SECRET/SERVICE_ROLE/ANON) no .env.local.");
  process.exit(1);
}
const usandoServiceRole = !!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

// Lê todas as linhas de uma query paginada (.range()).
async function lerTudo(build) {
  const PAGE = 1000;
  let out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    out = out.concat(data);
    if (data.length < PAGE) break;
  }
  return out;
}

const sanitizar = (s) => String(s).replace(/[\/\\:*?"<>|]/g, "_");

// ── main ─────────────────────────────────────────────────────────────────────
console.log(`Origem: ${sbUrl} (${usandoServiceRole ? "service_role" : "anon"}) · bucket ${BUCKET}`);
console.log(`Destino: ${OUT}${DRY ? "  [DRY-RUN]" : ""}${SKU_PREFIX ? `  · filtro sku^="${SKU_PREFIX}"` : ""}\n`);

let q = () => sb.from("fotos").select("sku, storage_path, ordem").order("sku").order("ordem");
if (SKU_PREFIX) q = () => sb.from("fotos").select("sku, storage_path, ordem").like("sku", `${SKU_PREFIX}%`).order("sku").order("ordem");
let fotos = await lerTudo(q);

// agrupa por sku (já vem ordenado por sku, ordem)
const porSku = new Map();
for (const f of fotos) {
  if (!porSku.has(f.sku)) porSku.set(f.sku, []);
  porSku.get(f.sku).push(f);
}
let skus = [...porSku.keys()];
if (LIMIT) skus = skus.slice(0, LIMIT);

const total = skus.reduce((n, s) => n + porSku.get(s).length, 0);
console.log(`SKUs: ${skus.length} · fotos: ${total}\n`);

if (!DRY) { mkdirSync(OUT, { recursive: true }); }

let ok = 0, falhas = 0, pulados = 0;
for (const sku of skus) {
  const lista = porSku.get(sku);
  const multi = lista.length > 1;
  let i = 0;
  for (const f of lista) {
    i++;
    const ext = (f.storage_path.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const nome = multi
      ? `${sanitizar(sku)}_${String(i).padStart(2, "0")}.${ext}`
      : `${sanitizar(sku)}.${ext}`;
    const destino = resolve(OUT, nome);

    if (DRY) { console.log(`  ${nome}  ←  ${f.storage_path}`); ok++; continue; }
    if (existsSync(destino)) { pulados++; continue; } // idempotente: não rebaixa

    const { data, error } = await sb.storage.from(BUCKET).download(f.storage_path);
    if (error || !data) { console.warn(`  ! falha ${nome} (${f.storage_path}): ${error?.message || "sem dados"}`); falhas++; continue; }
    writeFileSync(destino, Buffer.from(await data.arrayBuffer()));
    ok++;
    if (ok % 50 === 0) console.log(`  ... ${ok} baixadas`);
  }
}

console.log(`\nResumo: ${DRY ? "listadas" : "baixadas"}=${ok} · puladas(já existiam)=${pulados} · falhas=${falhas}`);
if (!DRY) console.log(`Pasta: ${OUT}`);
