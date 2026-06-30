// enriquecer_precos.mjs — Fase 5: pesquisa de IA em massa. Enriquece os itens via a
// edge function enriquecer-produto (IA Claude) e APLICA o resultado de venda:
//   • preco_ideal  = preço recomendado (motor pricing.js, a partir das refs da IA)
//   • titulo_anuncio = título do anúncio sugerido (sobrescreve — só a publicação)
//   • badge IA      = preco_ref_fonte="IA:claude" p/ TODO item que participa da pesquisa
// (Os demais campos — descrição, bullets, ficha, dimensões — só preenchem se vazios.)
//
// Reusa a enriquecer-produto (que detém a ANTHROPIC_API_KEY como secret) e autentica
// com a SUPABASE_SERVICE_ROLE_KEY (branch batch da função). Escreve direto em itens
// (bypassa RLS via service-role).
//
// Uso:
//   node scripts/enriquecer_precos.mjs                       # DRY-RUN, todos os elegíveis
//   node scripts/enriquecer_precos.mjs --limit 5             # amostra de 5 (dry-run)
//   node scripts/enriquecer_precos.mjs --classes A+,B,C      # restringe as classes-alvo
//   node scripts/enriquecer_precos.mjs --triados --apply     # só itens triados (status != A_CATALOGAR)
//   node scripts/enriquecer_precos.mjs --com-foto --apply    # só itens com foto
//   node scripts/enriquecer_precos.mjs --apply --conc 8      # grava todos, 8 simultâneos
// Flags: --apply (grava) · --classes L (default A+,A,B,C) · --triados · --com-foto · --limit N · --conc N
//
// Resume-safe: filtra preco_ref_novo IS NULL, então re-rodar continua de onde parou.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { precificar, estadoToCondicao, normalizarCanal, DEFAULT_PARAMS } from "../src/lib/pricing.js";

// --- env (.env.local não é auto-carregado pelo Node) ---
const env = {};
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch { /* usa process.env */ }
const URL_ = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
// Banco (PostgREST) usa o novo formato sb_secret_; a função usa o branch isBatch
// que compara com a service-role JWT legada (SUPABASE_SERVICE_ROLE_KEY, injetada na função).
const SECRET = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SECRET || !SERVICE) { console.error("Faltam VITE_SUPABASE_URL / SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY no .env.local"); process.exit(1); }

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const TRIADOS = args.includes("--triados");   // só status != A_CATALOGAR (melhor input)
const COMFOTO = args.includes("--com-foto");  // só itens com foto_feita
const FOTOS = args.includes("--fotos");        // envia as fotos do item à IA (mais preciso, ~3-4x custo)
const limIdx = args.indexOf("--limit");
const LIMIT = limIdx >= 0 ? Number(args[limIdx + 1]) : null;
const concIdx = args.indexOf("--conc");
const CONC = concIdx >= 0 ? Number(args[concIdx + 1]) : 4; // chamadas Claude simultâneas
const classesIdx = args.indexOf("--classes");
const CLASSES = classesIdx >= 0
  ? args[classesIdx + 1].split(",").map((s) => s.trim()).filter(Boolean)
  : ["A+", "A", "B", "C"];

const supabase = createClient(URL_, SECRET, { auth: { persistSession: false } });
const brl = (v) => v == null ? "—" : `R$${Number(v).toFixed(0)}`;

// Carrega os parâmetros do motor das tabelas pricing_* (mesmo shape de pricingParams.js),
// caindo nos DEFAULT_PARAMS quando a tabela vier vazia. Inclui o mapa de grupos com
// nível de risco e âncoras — necessário p/ derivar o preço recomendado igual ao app.
async function carregarParams() {
  const [cfg, cond, risco, canal, grupo, emb] = await Promise.all([
    supabase.from("pricing_config").select("*"),
    supabase.from("pricing_factor_condicao").select("*"),
    supabase.from("pricing_factor_risco").select("*"),
    supabase.from("pricing_canal").select("*"),
    supabase.from("pricing_grupo").select("*"),
    supabase.from("pricing_factor_embalagem").select("*"),
  ]);
  const C = {}; (cond.data || []).forEach((r) => (C[r.codigo] = { fator: Number(r.fator), ancora: r.ancora }));
  const E = {}; (emb.data || []).forEach((r) => (E[r.codigo] = Number(r.fator)));
  const R = {}; (risco.data || []).forEach((r) => (R[r.nivel] = Number(r.fator)));
  const K = {}; (canal.data || []).forEach((r) => (K[r.codigo] = { takeRate: Number(r.take_rate), fixo: Number(r.fixo) }));
  const g = {}; (cfg.data || []).forEach((r) => (g[r.key] = r.valor != null ? Number(r.valor) : r.valor_txt));
  const grupos = {};
  (grupo.data || []).forEach((r) => (grupos[r.grupo] = {
    nivelRisco: r.nivel_risco, ancoraNovo: r.ancora_novo, ancoraUsado: r.ancora_usado, classe: r.classe,
  }));
  return {
    condicao: Object.keys(C).length ? C : DEFAULT_PARAMS.condicao,
    embalagemFator: Object.keys(E).length ? E : DEFAULT_PARAMS.embalagemFator,
    risco: Object.keys(R).length ? R : DEFAULT_PARAMS.risco,
    canal: Object.keys(K).length ? K : DEFAULT_PARAMS.canal,
    grupos,
    config: {
      margemSP: g.margem_sp ?? 0.30, margemBelem: g.margem_belem ?? 0.50,
      reserva: g.reserva ?? 0.05, embalagem: g.embalagem ?? 25,
      freteKg: g.frete_kg ?? 3.0, freteMin: g.frete_min ?? 15,
      convNovoUsado: g.conv_novo_usado ?? 0.60, condicaoPadrao: g.condicao_padrao ?? "USADO_OK",
    },
  };
}

// Preço recomendado (= "valor ideal"): mesmo motor do PricingCard (precificar→pAnuncio).
// Não depende do custo do lote, então rodamos com custoItem=0 no batch. As referências
// vêm da IA (refNovo/refUsado); caem na âncora da categoria quando a IA não retorna preço.
function recomendadoDe(it, refNovo, refUsado, params) {
  const grupo = params.grupos?.[it.grupo] || {};
  const rNovo = refNovo ?? grupo.ancoraNovo ?? null;
  const rUsado = refUsado ?? grupo.ancoraUsado ?? null;
  if (rNovo == null && rUsado == null) return 0;
  const risco = grupo.nivelRisco && grupo.nivelRisco !== "None" ? grupo.nivelRisco : "MEDIO";
  const r = precificar({
    condicaoCod: estadoToCondicao(it.estado, params.config.condicaoPadrao),
    canalCod: normalizarCanal(it.canal_principal),
    riscoNivel: risco,
    embalagemCod: it.cond_embalagem || "PERFEITA",
    destino: it.destino,
    pesoKg: it.peso_real_kg ?? it.peso_kg ?? 0,
    refNovo: rNovo, refUsado: rUsado, custoItem: 0,
  }, params);
  return r.pAnuncio;
}

// Signed URLs das fotos do item (até 3, por ordem) para enviar à IA. Bucket fotos-produtos.
async function fotosDoItem(sku) {
  const { data } = await supabase.from("fotos").select("storage_path, ordem").eq("sku", sku).order("ordem").limit(3);
  const urls = [];
  for (const f of (data || [])) {
    if (!f.storage_path) continue;
    const { data: s } = await supabase.storage.from("fotos-produtos").createSignedUrl(f.storage_path, 600);
    if (s?.signedUrl) urls.push(s.signedUrl);
  }
  return urls;
}

async function main() {
  const filtros = [TRIADOS && "triados", COMFOTO && "com-foto", FOTOS && "envia fotos", LIMIT && `limite ${LIMIT}`, `conc ${CONC}`].filter(Boolean).join(" · ");
  console.log(`Modo: ${APPLY ? "APLICAR (grava)" : "DRY-RUN (não grava)"}${filtros ? ` · ${filtros}` : ""}\n`);

  const params = await carregarParams();
  const categorias = Object.keys(params.grupos || {});

  let q = supabase.from("itens")
    .select("sku, produto, marca, modelo, grupo, gtin, ncm, estado, voltagem, cor, titulo_anuncio, descricao_anuncio, comprimento_cm, largura_cm, altura_cm, peso_real_kg, peso_kg, medidas_fonte, bullet_points, palavras_chave, ficha_tecnica, classe, cond_embalagem, canal_principal, destino, preco_ideal")
    .in("classe", CLASSES)
    .is("preco_ref_novo", null)
    .order("sku");
  if (TRIADOS) q = q.neq("status", "A_CATALOGAR");
  if (COMFOTO) q = q.eq("foto_feita", true);
  if (LIMIT) q = q.limit(LIMIT);
  const { data: itens, error } = await q;
  if (error) { console.error("Erro ao buscar itens:", error.message); process.exit(1); }

  console.log(`${itens.length} itens elegíveis (classe ${CLASSES.join("/")} sem preco_ref_novo)\n`);
  if (!itens.length) return;

  let ok = 0, semPreco = 0, falhou = 0, gravados = 0;

  async function processar(it) {
    const body = {
      produto: it.produto, marca: it.marca, modelo: it.modelo, grupo: it.grupo,
      gtin: it.gtin, ncm: it.ncm, estado: it.estado, voltagem: it.voltagem,
      dimensoes: {
        comprimento_cm: it.comprimento_cm, largura_cm: it.largura_cm,
        altura_cm: it.altura_cm, peso_kg: it.peso_real_kg ?? it.peso_kg,
      },
      categorias,
    };
    if (FOTOS) {
      const furls = await fotosDoItem(it.sku);
      if (furls.length) body.fotos_urls = furls;
    }
    let data;
    try {
      const r = await supabase.functions.invoke("enriquecer-produto", { body });
      if (r.error) throw new Error(r.error.message || String(r.error));
      data = r.data;
    } catch (e) { falhou++; console.log(`  ✗ ${it.sku}  (erro: ${String(e.message).slice(0, 80)})`); return; }

    const novo = data?.preco_ref_novo ?? null;
    // Monta o patch. Regra geral: campos de FICHA preenchem só o que está vazio (nunca
    // sobrescreve humano). Exceções da pesquisa de IA: título do anúncio, preço ideal e
    // o badge IA — esses são APLICADOS para todo item que participa (decisão do operador).
    const vazio = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
    const patch = {};
    // Badge IA: marca TODO item que passou pela pesquisa (mesmo sem preço da IA).
    patch.preco_ref_fonte = data.preco_ref_fonte || "IA:claude";
    if (novo != null) {
      patch.preco_ref_novo = novo;
      patch.preco_ref_usado = data.preco_ref_usado ?? null;
      patch.preco_ref_confianca = data.preco_ref_confianca || null;
    }
    // Preço ideal (valor de venda) = recomendado do motor a partir das refs da IA.
    const recomendado = recomendadoDe(it, novo, data.preco_ref_usado, params);
    if (recomendado > 0) patch.preco_ideal = recomendado;
    // Título do anúncio (publicação) — sobrescreve; o nome interno (produto) fica intacto.
    if (data.titulo_anuncio) patch.titulo_anuncio = data.titulo_anuncio;
    if (vazio(it.descricao_anuncio) && data.descricao_anuncio) patch.descricao_anuncio = data.descricao_anuncio;
    if (vazio(it.marca) && data.marca) patch.marca = data.marca;
    if (vazio(it.modelo) && data.modelo) patch.modelo = data.modelo;
    if (vazio(it.cor) && data.cor) patch.cor = data.cor;
    if (vazio(it.voltagem) && data.voltagem && data.voltagem !== "N/A") patch.voltagem = data.voltagem;
    if (vazio(it.ncm) && data.ncm) patch.ncm = data.ncm;
    if (vazio(it.bullet_points) && Array.isArray(data.pontos) && data.pontos.length) patch.bullet_points = data.pontos;
    if (vazio(it.palavras_chave) && data.palavras_chave) patch.palavras_chave = data.palavras_chave;
    if (vazio(it.ficha_tecnica) && Array.isArray(data.ficha_tecnica) && data.ficha_tecnica.length) patch.ficha_tecnica = data.ficha_tecnica;
    // Dimensões estimadas: só quando TODAS as 3 estão vazias (marca a fonte como estimada).
    const de = data.dimensoes_estimadas || {};
    if (vazio(it.comprimento_cm) && vazio(it.largura_cm) && vazio(it.altura_cm) && (de.comprimento_cm || de.largura_cm || de.altura_cm)) {
      if (de.comprimento_cm) patch.comprimento_cm = de.comprimento_cm;
      if (de.largura_cm) patch.largura_cm = de.largura_cm;
      if (de.altura_cm) patch.altura_cm = de.altura_cm;
      if (vazio(it.peso_real_kg) && vazio(it.peso_kg) && de.peso_kg) patch.peso_real_kg = de.peso_kg;
      if (vazio(it.medidas_fonte)) patch.medidas_fonte = "IA (estimado)";
    }

    if (novo == null) { semPreco++; }
    else { ok++; }
    const extras = [
      patch.bullet_points ? `+${patch.bullet_points.length}bullets` : null,
      patch.palavras_chave ? "+kw" : null,
      patch.ficha_tecnica ? `+ficha(${patch.ficha_tecnica.length})` : null,
      patch.titulo_anuncio ? "+título" : null,
      patch.preco_ideal ? `→venda ${brl(patch.preco_ideal)}` : null,
      patch.comprimento_cm ? "+dims~" : null,
      data.usou_foto ? "📷" : null,
    ].filter(Boolean).join(" ");
    console.log(`  ${novo == null ? "~" : "✓"} ${it.sku}  ${(it.produto || "").slice(0, 32).padEnd(32)}  ${novo == null ? "sem preço" : `novo ${brl(novo)}·usado ${brl(data.preco_ref_usado)} (${data.preco_ref_confianca})`}  ${extras}`);

    if (APPLY && Object.keys(patch).length) {
      const { error: upErr } = await supabase.from("itens").update(patch).eq("sku", it.sku);
      if (upErr) console.log(`     ! falha ao gravar ${it.sku}: ${upErr.message}`);
      else gravados++;
    }
  }

  // pool de concorrência simples
  let i = 0;
  async function worker() { while (i < itens.length) { await processar(itens[i++]); } }
  await Promise.all(Array.from({ length: Math.min(CONC, itens.length) }, worker));

  console.log(`\nResumo: ${ok} com preço · ${semPreco} sem preço da IA · ${falhou} falhas${APPLY ? ` · ${gravados} gravados` : " · (dry-run, nada gravado)"}`);
  if (!APPLY && ok) console.log("Rode com --apply para gravar preco_ref_* nos itens.");
}

main().catch((e) => { console.error(e); process.exit(1); });
