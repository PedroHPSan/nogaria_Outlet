// backfill_classe.mjs — dá CLASSE a todos os itens que estão sem (classe IS NULL),
// pelo mesmo sinal do app: preço → âncora de categoria → C (lib/classificacao.js →
// classeAutomatica). Espelha conferencia.js → classificarSemClasse, com dry-run.
//
// Uso:
//   node scripts/backfill_classe.mjs            # DRY-RUN: mostra a distribuição, não grava
//   node scripts/backfill_classe.mjs --apply    # grava classe + loga eventos classe:backfill
//
// Idempotente: só toca itens com classe nula.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { classeAutomatica } from "../src/lib/classificacao.js";

const env = {};
try { for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); } } catch { /* usa process.env */ }
const URL_ = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) { console.error("Faltam VITE_SUPABASE_URL / SUPABASE_SECRET_KEY no .env.local"); process.exit(1); }

const APPLY = process.argv.includes("--apply");
const supabase = createClient(URL_, KEY, { auth: { persistSession: false } });

async function main() {
  console.log(`Modo: ${APPLY ? "APLICAR (grava classe)" : "DRY-RUN (não grava)"}\n`);

  // Monta os params no shape esperado por classeAutomatica/valorReferencia.
  const [{ data: grupos }, { data: cfg }] = await Promise.all([
    supabase.from("pricing_grupo").select("grupo, classe, ancora_novo, ancora_usado"),
    supabase.from("pricing_config").select("key, valor").eq("key", "conv_novo_usado").maybeSingle(),
  ]);
  const params = {
    grupos: Object.fromEntries((grupos || []).map((g) => [g.grupo, {
      classe: g.classe, ancoraNovo: g.ancora_novo, ancoraUsado: g.ancora_usado,
    }])),
    config: { convNovoUsado: cfg?.valor != null ? Number(cfg.valor) : 0.6 },
  };

  // Carrega todos os itens sem classe (paginado).
  const PAGE = 1000;
  let itens = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("itens")
      .select("sku, grupo, preco_ideal, preco_sugerido, preco_ref_usado, preco_ref_novo, preco_novo_est")
      .is("classe", null).order("sku").range(from, from + PAGE - 1);
    if (error) { console.error(error.message); process.exit(1); }
    if (!data?.length) break;
    itens = itens.concat(data);
    if (data.length < PAGE) break;
  }
  console.log(`${itens.length} itens sem classe\n`);
  if (!itens.length) return;

  // Agrupa por classe calculada + conta a origem (valor/categoria/fallback).
  const porClasseSkus = {}, porClasse = {}, porOrigem = {};
  for (const it of itens) {
    const { classe, origem } = classeAutomatica(it, params);
    (porClasseSkus[classe] = porClasseSkus[classe] || []).push(it.sku);
    porClasse[classe] = (porClasse[classe] || 0) + 1;
    porOrigem[origem] = (porOrigem[origem] || 0) + 1;
  }
  console.log("Distribuição por classe:", porClasse);
  console.log("Origem do sinal:", porOrigem, "\n");

  if (!APPLY) { console.log("Rode com --apply para gravar."); return; }

  let gravados = 0;
  for (const [classe, skus] of Object.entries(porClasseSkus)) {
    for (let i = 0; i < skus.length; i += 200) {
      const slice = skus.slice(i, i + 200);
      const { error } = await supabase.from("itens").update({ classe }).in("sku", slice);
      if (error) { console.error(`falha ${classe}:`, error.message); continue; }
      gravados += slice.length;
    }
  }
  // Auditoria best-effort.
  try {
    const eventos = [];
    for (const [classe, skus] of Object.entries(porClasseSkus))
      for (const sku of skus) eventos.push({ sku, acao: "classe:backfill", detalhe: classe, usuario: "backfill_classe.mjs" });
    for (let i = 0; i < eventos.length; i += 500) await supabase.from("eventos").insert(eventos.slice(i, i + 500));
  } catch { /* best-effort */ }

  console.log(`\nGravados: ${gravados} itens.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
