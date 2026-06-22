#!/usr/bin/env node
// Backfill (one-off): replica as fotos do item ORIGINAL para as unidades irmãs
// criadas em desmembramentos PASSADOS, que nasceram sem foto (antes da rotina de
// cópia automática existir em src/lib/conferencia.js → desmembrarItem).
//
// Identificação CONSERVADORA por eventos: só age sobre itens que têm evento
// `desmembrado`. A partir do SKU original do evento, monta o "grupo de identidade"
// (itens do MESMO lote com produto/marca/modelo/grupo/gtin/cor/estado idênticos e
// num_serie nulo — assinatura de cópia de split), copia da fonte (membro com fotos,
// preferindo o original) para os alvos SEM nenhuma foto. Nunca toca em item que já
// tem foto; nunca toca em item sem evento de desmembramento.
//
// USO:
//   export SUPABASE_URL='https://yqimfktanresuboqfdti.supabase.co'
//   export SUPABASE_SERVICE_ROLE_KEY='...'   # service_role (bypass RLS; NÃO comitar)
//   node scripts/backfill_fotos_desmembrados.mjs          # dry-run (só relatório)
//   node scripts/backfill_fotos_desmembrados.mjs --apply  # aplica as cópias

import { createClient } from "@supabase/supabase-js";

const BUCKET = "fotos-produtos";
// Campos que definem a identidade do produto (espelha CAMPOS_COPIA do split).
const ID_FIELDS = ["produto", "grupo", "marca", "modelo", "gtin", "cor", "estado"];

const need = (name) => {
  const v = process.env[name];
  if (!v) { console.error(`Falta a variável de ambiente ${name}.`); process.exit(1); }
  return v;
};

const APPLY = process.argv.includes("--apply");
const sbUrl = (process.env.SUPABASE_URL || "https://yqimfktanresuboqfdti.supabase.co").replace(/\/$/, "");
const sbKey = need("SUPABASE_SERVICE_ROLE_KEY");
const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

// Lê todas as linhas de uma query paginada (.range()), como no Dashboard.
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

// "+2 unidade(s): NOG-..." → 2  (só o número; ignora a lista de SKUs do detalhe novo)
const parseExtras = (detalhe) => {
  const m = /\+(\d+)\s*unidade/i.exec(detalhe || "");
  return m ? Number(m[1]) : 0;
};

const igual = (a, b) => (a ?? null) === (b ?? null);
const mesmaIdentidade = (x, y) => ID_FIELDS.every((k) => igual(x[k], y[k]));

// Cópia física de todas as fotos de skuOrigem → skuDestino (mesma lógica de copiarFotos).
async function copiarFotos(skuOrigem, skuDestino) {
  const { data: origem, error } = await sb
    .from("fotos").select("storage_path, ordem").eq("sku", skuOrigem).order("ordem");
  if (error || !origem?.length) return 0;
  let n = 0;
  for (const f of origem) {
    const ext = (f.storage_path.split(".").pop() || "jpg").toLowerCase();
    const novoPath = `${skuDestino}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error: ce } = await sb.storage.from(BUCKET).copy(f.storage_path, novoPath);
    if (ce) { console.warn(`  ! copy falhou ${skuDestino}: ${ce.message}`); continue; }
    const { error: ie } = await sb.from("fotos").insert({ sku: skuDestino, storage_path: novoPath, ordem: f.ordem });
    if (ie) { await sb.storage.from(BUCKET).remove([novoPath]); console.warn(`  ! insert falhou ${skuDestino}: ${ie.message}`); continue; }
    n++;
  }
  if (n) await sb.from("itens").update({ foto_feita: true }).eq("sku", skuDestino);
  return n;
}

// ───────────────────────────── main ─────────────────────────────
console.log(`Modo: ${APPLY ? "APLICAR (--apply)" : "DRY-RUN (sem alterações)"} · ${sbUrl}\n`);

// 1) eventos de desmembramento → mapa original_sku → N esperado (soma).
const eventos = await lerTudo(() => sb.from("eventos").select("sku, detalhe").eq("acao", "desmembrado"));
const esperadoPorSku = new Map();
for (const e of eventos) esperadoPorSku.set(e.sku, (esperadoPorSku.get(e.sku) || 0) + parseExtras(e.detalhe));
console.log(`Eventos 'desmembrado': ${eventos.length} · SKUs originais distintos: ${esperadoPorSku.size}\n`);

// 2) carrega os itens originais e seus lotes; depois os itens dos lotes envolvidos.
const skusOriginais = [...esperadoPorSku.keys()];
const originais = [];
for (let i = 0; i < skusOriginais.length; i += 300) {
  const { data, error } = await sb.from("itens")
    .select(`sku, lote, num_serie, ${ID_FIELDS.join(", ")}`)
    .in("sku", skusOriginais.slice(i, i + 300));
  if (error) throw error;
  if (data) originais.push(...data);
}
const lotes = [...new Set(originais.map((o) => o.lote).filter((l) => l != null))];

// Itens de todos os lotes envolvidos (candidatos a irmãos).
const itensPorLote = new Map();
for (const lote of lotes) {
  const itens = await lerTudo(() =>
    sb.from("itens").select(`sku, lote, num_serie, ${ID_FIELDS.join(", ")}`).eq("lote", lote).order("sku"));
  itensPorLote.set(lote, itens);
}

// 3) quais SKUs têm foto (para definir fonte/alvos).
const todosSkus = [...new Set([].concat(...[...itensPorLote.values()]).map((i) => i.sku))];
const comFoto = new Set();
for (let i = 0; i < todosSkus.length; i += 300) {
  const { data } = await sb.from("fotos").select("sku").in("sku", todosSkus.slice(i, i + 300));
  for (const f of data || []) comFoto.add(f.sku);
}

// 4) processa cada original.
let grupos = 0, preenchidas = 0, fotosCopiadas = 0, pulados = 0;
for (const orig of originais) {
  const esperado = esperadoPorSku.get(orig.sku) || 0;
  if (orig.lote == null) { console.log(`- ${orig.sku}: sem lote — pulado`); pulados++; continue; }
  const lista = itensPorLote.get(orig.lote) || [];

  // grupo de identidade = original + irmãos idênticos (num_serie nulo).
  const grupo = lista.filter((it) =>
    (it.sku === orig.sku) ||
    (it.num_serie == null && mesmaIdentidade(it, orig)));

  const fonte = grupo.find((it) => it.sku === orig.sku && comFoto.has(it.sku))
    || grupo.find((it) => comFoto.has(it.sku));
  const alvos = grupo.filter((it) => !comFoto.has(it.sku));

  if (!fonte) { console.log(`- ${orig.sku} (lote ${orig.lote}): grupo sem fotos — pulado`); pulados++; continue; }
  if (!alvos.length) { console.log(`- ${orig.sku} (lote ${orig.lote}): sem alvos a preencher`); continue; }

  grupos++;
  const aviso = alvos.length !== esperado ? `  ⚠ alvos=${alvos.length} ≠ esperado=${esperado}` : "";
  console.log(`- ${orig.sku} (lote ${orig.lote}): fonte ${fonte.sku} → ${alvos.length} alvo(s)${aviso}`);
  for (const a of alvos) {
    if (APPLY) {
      const n = await copiarFotos(fonte.sku, a.sku);
      console.log(`    ${a.sku}: ${n} foto(s) copiada(s)`);
      if (n) { preenchidas++; fotosCopiadas += n; }
    } else {
      console.log(`    ${a.sku}: (dry-run) copiaria de ${fonte.sku}`);
      preenchidas++;
    }
  }
}

console.log(`\nResumo: grupos=${grupos} · unidades ${APPLY ? "preenchidas" : "a preencher"}=${preenchidas} · fotos copiadas=${fotosCopiadas} · pulados=${pulados}`);
if (!APPLY) console.log("Rode novamente com --apply para executar.");
