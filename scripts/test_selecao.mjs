// Testes da seleção em massa (selecao.js). Rode: npm run test:selecao
import assert from "node:assert/strict";
import {
  alternarSelecao, marcarTodos, desmarcarTodos, todosSelecionados, selecionados,
} from "../src/lib/selecao.js";

let passou = 0;
const ok = (c, msg) => { assert.ok(c, msg); passou++; console.log(`  ok  ${msg}`); };
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

const it = (sku, extra = {}) => ({ sku, produto: `P-${sku}`, ...extra });
const pagina1 = [it("NOG-A"), it("NOG-B")];
const pagina2 = [it("NOG-C"), it("NOG-D")];
const skus = (arr) => arr.map((i) => i.sku).join(",");

console.log("alternarSelecao");
let sel = alternarSelecao(new Map(), pagina1[0]);
eq(sel.size, 1, "marca o item");
eq(alternarSelecao(sel, pagina1[0]).size, 0, "clicar de novo desmarca");
ok(alternarSelecao(sel, pagina1[1]) !== sel, "não muta o mapa anterior");
eq(sel.size, 1, "mapa original intacto");

console.log("marcarTodos / desmarcarTodos / todosSelecionados");
const todos1 = marcarTodos(new Map(), pagina1);
ok(todosSelecionados(todos1, pagina1), "página toda marcada");
ok(!todosSelecionados(todos1, pagina2), "outra página não");
ok(!todosSelecionados(new Map(), []), "lista vazia não conta como 'todos'");
eq(desmarcarTodos(todos1, pagina1).size, 0, "desmarca a página");
eq(desmarcarTodos(marcarTodos(todos1, pagina2), pagina1).size, 2, "desmarcar a pág.1 preserva a pág.2");

console.log("REGRESSÃO: seleção sobrevive à troca de filtro/página");
// Marca 1 item na pág.1, a lista em tela vira a pág.2, marca mais 1 lá.
let s = alternarSelecao(new Map(), pagina1[0]);
s = alternarSelecao(s, pagina2[1]);
const lote = selecionados(s, pagina2); // <- em tela só existe a pág.2
eq(lote.length, 2, "os 2 escolhidos entram, mesmo com só a pág.2 em tela");
eq(skus(lote), "NOG-A,NOG-D", "inclui o item que saiu da tela");
eq(lote.length, s.size, "contagem do botão bate com o que é gerado");

console.log("selecionados: ordenado por SKU, não por ordem de clique");
let ordem = alternarSelecao(new Map(), pagina2[0]);   // C primeiro
ordem = alternarSelecao(ordem, pagina1[0]);           // A depois
eq(skus(selecionados(ordem, [])), "NOG-A,NOG-C", "ordena por SKU");

console.log("selecionados: refresca a cópia guardada com o dado em tela");
let stale = alternarSelecao(new Map(), it("NOG-A", { foto_feita: false }));
const fresco = selecionados(stale, [it("NOG-A", { foto_feita: true })]);
eq(fresco[0].foto_feita, true, "usa a versão atualizada quando o item está em tela");
eq(selecionados(stale, []).length, 1, "sem nada em tela, mantém a cópia guardada");
eq(selecionados(new Map(), pagina1).length, 0, "nada selecionado → lote vazio");

console.log(`\n${passou} asserções OK`);
