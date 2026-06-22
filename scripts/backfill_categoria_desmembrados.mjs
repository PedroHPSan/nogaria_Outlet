#!/usr/bin/env node
// Backfill (one-off): propaga a CATEGORIA (grupo) e a classe do item ORIGINAL para
// as unidades irmãs criadas em desmembramentos PASSADOS que ficaram SEM categoria
// (desmembradas antes de o original ser categorizado). Espelha a propagação que
// agora roda ao categorizar em src/lib/conferencia.js → propagarCategoriaIrmaos.
//
// Identificação CONSERVADORA por eventos: só age sobre grupos que têm evento
// `desmembrado`. A partir do SKU original do evento, monta o "grupo de identidade"
// (itens do MESMO lote com produto/marca/modelo/grupo*/gtin/cor/estado idênticos e
// num_serie nulo — assinatura de cópia de split). A FONTE da categoria é um membro
// já categorizado (preferindo o original); os ALVOS são os membros SEM categoria.
// Nunca sobrescreve categoria já definida; nunca toca em item sem desmembramento.
// (*) a identidade casa em produto/marca/modelo/gtin/cor/estado — NÃO em grupo, que
//     é justamente o campo que pode divergir (alvo nulo vs. fonte categorizada).
//
// USO:
//   export SUPABASE_URL='https://yqimfktanresuboqfdti.supabase.co'
//   export SUPABASE_SERVICE_ROLE_KEY='...'   # service_role (bypass RLS; NÃO comitar)
//   node scripts/backfill_categoria_desmembrados.mjs          # dry-run (só relatório)
//   node scripts/backfill_categoria_desmembrados.mjs --apply  # aplica as mudanças

import { createClient } from "@supabase/supabase-js";

// Identidade do produto (espelha IRMAOS_ID de conferencia.js — sem o grupo).
const ID_FIELDS = ["produto", "marca", "modelo", "gtin", "cor", "estado"];

const need = (name) => {
  const v = process.env[name];
  if (!v) { console.error(`Falta a variável de ambiente ${name}.`); process.exit(1); }
  return v;
};

const APPLY = process.argv.includes("--apply");
const sbUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://yqimfktanresuboqfdti.supabase.co").replace(/\/$/, "");
// Aceita a chave no formato novo (SUPABASE_SECRET_KEY: sb_secret_…) ou o legado.
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  || need("SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SECRET_KEY)");
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

const igual = (a, b) => (a ?? null) === (b ?? null);
const mesmaIdentidade = (x, y) => ID_FIELDS.every((k) => igual(x[k], y[k]));

// ───────────────────────────── main ─────────────────────────────
console.log(`Modo: ${APPLY ? "APLICAR (--apply)" : "DRY-RUN (sem alterações)"} · ${sbUrl}\n`);

// 1) SKUs originais que sofreram desmembramento (conservador — só estes contam).
const eventos = await lerTudo(() => sb.from("eventos").select("sku").eq("acao", "desmembrado"));
const skusOriginais = [...new Set(eventos.map((e) => e.sku))];
console.log(`Eventos 'desmembrado': ${eventos.length} · SKUs originais distintos: ${skusOriginais.length}\n`);

// 2) carrega os originais (lote + identidade + categoria) e os lotes envolvidos.
const sel = `sku, lote, num_serie, grupo, classe, ${ID_FIELDS.join(", ")}`;
const originais = [];
for (let i = 0; i < skusOriginais.length; i += 300) {
  const { data, error } = await sb.from("itens").select(sel).in("sku", skusOriginais.slice(i, i + 300));
  if (error) throw error;
  if (data) originais.push(...data);
}
const lotes = [...new Set(originais.map((o) => o.lote).filter((l) => l != null))];

// Itens de todos os lotes envolvidos (candidatos a irmãos).
const itensPorLote = new Map();
for (const lote of lotes) {
  itensPorLote.set(lote, await lerTudo(() => sb.from("itens").select(sel).eq("lote", lote).order("sku")));
}

// 3) processa cada original.
let grupos = 0, preenchidos = 0, pulados = 0;
const vistos = new Set(); // evita reprocessar o mesmo grupo de identidade (várias entradas)
for (const orig of originais) {
  if (orig.lote == null) { console.log(`- ${orig.sku}: sem lote — pulado`); pulados++; continue; }
  const lista = itensPorLote.get(orig.lote) || [];

  // grupo de identidade = original + irmãos idênticos (num_serie nulo).
  const grupo = lista.filter((it) =>
    (it.sku === orig.sku) || (it.num_serie == null && mesmaIdentidade(it, orig)));

  // chave de dedupe: lote + identidade.
  const chave = `${orig.lote}|${ID_FIELDS.map((k) => orig[k] ?? "").join("|")}`;
  if (vistos.has(chave)) continue;
  vistos.add(chave);

  // Fonte da categoria: original (se categorizado) ou qualquer membro categorizado.
  const fonte = (orig.grupo ? orig : null) || grupo.find((it) => it.grupo);
  const alvos = grupo.filter((it) => !it.grupo);

  if (!fonte) { console.log(`- ${orig.sku} (lote ${orig.lote}): grupo sem categoria — pulado`); pulados++; continue; }
  if (!alvos.length) { console.log(`- ${orig.sku} (lote ${orig.lote}): sem alvos a preencher`); continue; }

  grupos++;
  console.log(`- ${orig.sku} (lote ${orig.lote}): fonte ${fonte.sku} [${fonte.grupo}${fonte.classe ? `/${fonte.classe}` : ""}] → ${alvos.length} alvo(s)`);
  const patch = { grupo: fonte.grupo };
  if (fonte.classe) patch.classe = fonte.classe;
  for (const a of alvos) {
    if (APPLY) {
      const { error } = await sb.from("itens").update(patch).eq("sku", a.sku);
      if (error) { console.warn(`    ! ${a.sku}: ${error.message}`); continue; }
      console.log(`    ${a.sku}: categorizado [${patch.grupo}${patch.classe ? `/${patch.classe}` : ""}]`);
      preenchidos++;
    } else {
      console.log(`    ${a.sku}: (dry-run) receberia [${patch.grupo}${patch.classe ? `/${patch.classe}` : ""}]`);
      preenchidos++;
    }
  }
}

console.log(`\nResumo: grupos=${grupos} · unidades ${APPLY ? "preenchidas" : "a preencher"}=${preenchidos} · pulados=${pulados}`);
if (!APPLY) console.log("Rode novamente com --apply para executar.");
