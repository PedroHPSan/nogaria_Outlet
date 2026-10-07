// Teste da camada de dados do motor v2 com um cliente Supabase FALSO em memória (sem rede, sem
// tocar produção). Cobre rateio do lote, fallback sem migration, pesos, snapshot e validação.
// Rode: npm run test:motorprecodb
import assert from "node:assert/strict";
import { DEFAULT_PARAMS } from "../src/lib/pricing.js";
import { usarCliente, calcularLote, analisarItens, validarPreco, salvarPesoRateio, fecharRateio, temPesoRateio, limparCache } from "../src/lib/motorPrecoDb.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ok  ${m}`); };
const eq = (a, b, m) => { assert.equal(a, b, m); n++; console.log(`  ok  ${m}`); };
const perto = (a, b, t, m) => { assert.ok(Math.abs(a - b) <= t, `${m}: ${a} vs ${b}`); n++; console.log(`  ok  ${m}`); };

// Cliente falso mínimo: from(t).select/range/eq/is/update/insert/upsert, thenable.
function fake(db, { semPesoRateio = false } = {}) {
  return {
    from(t) {
      const st = { t, f: [], op: "select", cols: "*", rng: null };
      const exec = () => {
        const tab = db[t];
        if (!tab) return { data: null, error: { message: `relation "${t}" does not exist` } };
        if (st.op === "select") {
          if (semPesoRateio && /peso_rateio/.test(st.cols)) return { data: null, error: { message: "column itens.peso_rateio does not exist" } };
          let rows = tab.filter((r) => st.f.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)));
          if (st.rng) rows = rows.slice(st.rng[0], st.rng[1] + 1);
          return { data: rows.map((r) => ({ ...r })), error: null };
        }
        const alvo = tab.filter((r) => st.f.every(([k, v]) => r[k] === v));
        if (st.op === "update") { alvo.forEach((r) => Object.assign(r, st.patch)); return { data: null, error: null }; }
        if (st.op === "insert") { tab.push(...[].concat(st.patch)); return { data: null, error: null }; }
        if (st.op === "upsert") { for (const row of st.patch) { const i = tab.findIndex((r) => r.sku === row.sku); i >= 0 ? Object.assign(tab[i], row) : tab.push({ ...row }); } return { data: null, error: null }; }
        return { data: null, error: null };
      };
      const b = {
        select(c) { st.cols = c; return b; }, range(a, z) { st.rng = [a, z]; return b; },
        eq(k, v) { st.f.push([k, v]); return b; }, is(k, v) { st.f.push([k, v]); return b; },
        update(p) { st.op = "update"; st.patch = p; return b; }, insert(r) { st.op = "insert"; st.patch = r; return b; },
        upsert(r) { st.op = "upsert"; st.patch = r; return b; },
        then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
      };
      return b;
    },
  };
}

const novoDb = () => ({
  lotes: [{ lote: 7, lance_final: 1000, custo_total: 1050, valor_pago_hisa: 1300, comissao_leiloeiro: 50, taxa_hisa: 250, frete_retirada: 100, frete_transferencia: 0, outros_custos: 0 }],
  itens: [
    { sku: "A", lote: 7, produto: "Capa", grupo: "X", estado: "Novo", preco_ref_novo: 40, peso_kg: 0.1, preco_ideal: null },
    { sku: "B", lote: 7, produto: "Fone", grupo: "Y", estado: "Novo", preco_ref_novo: 300, peso_kg: 0.5, preco_ideal: 250 },
    { sku: "C", lote: 7, produto: "Robô", grupo: "Z", estado: "Novo", preco_ref_novo: 2000, peso_kg: 5, preco_ideal: 1600 },
  ],
  eventos: [], item_peso_rateio_log: [], item_custo_snapshot: [],
});

console.log("rateio do lote com composição real");
let db = novoDb();
usarCliente(fake(db));
limparCache();
const calc = await calcularLote(7, DEFAULT_PARAMS, { force: true });
perto(calc.custo.total, 1400, 0.01, "custo composto = lance + 5% + taxa + frete real (1000+50+250+100)");
eq(calc.custo.origem, "real (composição no banco)", "origem: composição real");
perto(calc.linhas.reduce((s, l) => s + l.custo, 0), 1400, 0.01, "Σ custo alocado fecha no custo do lote");
ok(calc.linhas[0].custo < calc.linhas[1].custo && calc.linhas[1].custo < calc.linhas[2].custo, "custo cresce com o valor do item");

console.log("pesos manuais (pré-visualização e fallback sem migration)");
const prev = await calcularLote(7, DEFAULT_PARAMS, { force: true, pesos: { C: 0.25 } });
ok(prev.linhas[2].custo < calc.linhas[2].custo, "peso 0,25 no robô reduz o custo dele na prévia");
perto(prev.linhas.reduce((s, l) => s + l.custo, 0), 1400, 0.01, "prévia também fecha no custo do lote");
db = novoDb(); usarCliente(fake(db, { semPesoRateio: true })); limparCache();
const semMig = await calcularLote(7, DEFAULT_PARAMS, { force: true });
eq(temPesoRateio(), false, "sem a migration: detecta que peso_rateio não existe");
eq(semMig.linhas.length, 3, "sem a migration: o cálculo continua funcionando");
const rSemMig = await salvarPesoRateio({ sku: "A", k: 2, motivo: "teste", user: { email: "t@t" } });
eq(rSemMig.ok, true, "fake aceita update (em produção sem a coluna retornaria erro amigável)");
const semMotivo = await salvarPesoRateio({ sku: "A", k: 2, motivo: "  ", user: { email: "t@t" } });
eq(semMotivo.ok, false, "peso exige motivo");

console.log("análise e validação de preço");
db = novoDb(); usarCliente(fake(db)); limparCache();
const m = await analisarItens(db.itens, DEFAULT_PARAMS, { force: true });
ok(m.get("B").piso > 0 && m.get("B").explicacao.length >= 4, "item analisado traz piso e explicação");
const piso = m.get("C").piso;
const recusa = await validarPreco({ sku: "C", preco: piso - 1, piso, user: { email: "t@t" } });
eq(recusa.ok, false, "validar abaixo do piso é recusado");
eq(db.itens[2].preco_aprovacao, undefined, "recusa não grava nada");
const aceita = await validarPreco({ sku: "C", preco: Math.ceil(piso) + 10, piso, user: { email: "t@t" } });
eq(aceita.ok, true, "validar acima do piso é aceito");
eq(db.itens[2].preco_aprovacao, "APROVADO", "grava preco_aprovacao=APROVADO");
ok(db.eventos.some((e) => /preco:validado/.test(e.acao)), "registra evento de auditoria");

console.log("snapshot ao fechar o lote");
db = novoDb(); usarCliente(fake(db)); limparCache();
const fechou = await fecharRateio(7, DEFAULT_PARAMS, { email: "t@t" });
eq(fechou.ok, true, "fecha o rateio");
eq(db.item_custo_snapshot.length, 3, "um snapshot por item");
ok(db.lotes[0].fechado_em, "lote marcado como fechado");
const custoFechado = db.item_custo_snapshot.find((r) => r.sku === "C").custo_alocado;
db.itens[2].preco_ref_novo = 50; // item muda DEPOIS de fechado
limparCache();
const depois = await calcularLote(7, DEFAULT_PARAMS, { force: true });
eq(depois.linhas.find((l) => l.it.sku === "C").custo, custoFechado, "custo do lote fechado não muda quando o item muda");
eq(depois.fechado, true, "lote aparece como fechado");

console.log("lote sem cadastro de custo");
db = novoDb(); db.lotes = []; usarCliente(fake(db)); limparCache();
const sem = await analisarItens(db.itens, DEFAULT_PARAMS, { force: true });
eq(sem.get("A").semCusto, true, "sem custo cadastrado: sinaliza semCusto (a UI avisa)");

console.log(`\n${n} asserções OK`);
