// Teste das regras puras da sacola de WhatsApp (sacolasCore + transições). Rode: npm run test:sacolas
import assert from "node:assert/strict";
import { podeTransitar, statusEfetivo, prazoSacola } from "../src/lib/orcamentosCore.js";
import { mesmoCliente, sacolaAbertaDe, adicionarItem, removerItem, resumoSacolas, mensagemCobranca, linkCobranca, resumoDoDia, porCliente } from "../src/lib/sacolasCore.js";

const ok = (c, msg) => { assert.ok(c, msg); console.log(`  ok  ${msg}`); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); console.log(`  ok  ${msg}`); };

const agora = new Date("2026-10-28T12:00:00Z");
const sac = (o) => ({ origem: "whatsapp", status: "ABERTA", itens: [{ sku: "A", preco: 100 }], desconto_pct: 0, validade: "2026-10-30T12:00:00Z", ...o });

console.log("transições");
ok(podeTransitar("ABERTA", "VENDIDO"), "ABERTA → VENDIDO (pago)");
ok(podeTransitar("VENDIDO", "ENTREGUE"), "VENDIDO → ENTREGUE");
ok(!podeTransitar("ENTREGUE", "VENDIDO"), "ENTREGUE é terminal");
ok(!podeTransitar("ABERTA", "ENTREGUE"), "não entrega sem pagar");
eq(statusEfetivo(sac({ validade: "2026-10-27T00:00:00Z" }), agora), "EXPIRADO", "sacola vencida expira");
ok(new Date(prazoSacola(agora)) - agora === 3 * 86400000, "prazo padrão 3 dias");

console.log("cliente");
ok(mesmoCliente({ cliente_whatsapp: "5511999990000" }, { whatsapp: "+55 (11) 99999-0000" }), "casa por WhatsApp ignorando máscara");
ok(mesmoCliente({ cliente_nome: "José" }, { nome: " jose " }), "sem WhatsApp, casa por nome sem acento/caixa");
ok(!mesmoCliente({ cliente_whatsapp: "5511999990000", cliente_nome: "Ana" }, { nome: "Ana", whatsapp: "5511888880000" }), "WhatsApp diferente = outra pessoa");
eq(sacolaAbertaDe([sac({ status: "VENDIDO", cliente_nome: "Ana" }), sac({ cliente_nome: "Ana", codigo: "ORC-2" })], { nome: "Ana" }, agora)?.codigo, "ORC-2", "acha só sacola ABERTA");
eq(sacolaAbertaDe([sac({ origem: "orcamento", cliente_nome: "Ana" })], { nome: "Ana" }, agora), null, "ignora orçamento comum");

console.log("itens");
const it = { sku: "B", produto: "Fone", preco_ideal: 50 };
eq(adicionarItem([{ sku: "A", preco: 100 }], it).map((i) => i.sku), ["A", "B"], "soma o item");
eq(adicionarItem([{ sku: "B", preco: 50 }], it).length, 1, "idempotente por SKU");
assert.throws(() => adicionarItem([], { sku: "C" }), /sem preço/); ok(true, "recusa item sem preço");
eq(removerItem([{ sku: "A" }, { sku: "B" }], "A").map((i) => i.sku), ["B"], "remove item");

console.log("resumo");
const r = resumoSacolas([
  sac({ validade: "2026-10-28T20:00:00Z" }),
  sac({ itens: [{ sku: "X", preco: 40 }] }),
  sac({ status: "VENDIDO", valor_pago: 70 }),
  sac({ status: "ENTREGUE", valor_pago: 30 }),
  sac({ origem: "orcamento" }),
], agora);
eq(r, { abertas: 2, aReceber: 140, vencendo: 1, pagasSemEntrega: 1, recebido: 100 }, "contagens e valores");

console.log("cobrança");
const msg = mensagemCobranca(sac({ cliente_nome: "Ana", itens: [{ sku: "A", produto: "Fone", preco: 100 }, { sku: "B", produto: "Cabo", preco: 25.5 }] }));
ok(msg.includes("Total: R$ 125,50") && msg.includes("Fone (A)") && msg.startsWith("Olá, Ana!"), "mensagem lista itens e total");
ok(linkCobranca(sac({ cliente_whatsapp: "5511999990000" })).startsWith("https://wa.me/5511999990000?text="), "link wa.me do cliente");
eq(linkCobranca(sac({})), null, "sem WhatsApp, sem link");

console.log("painel do dia e por cliente");
const hoje = "2026-10-28T13:00:00Z", ontem = "2026-10-27T13:00:00Z";
const dia = resumoDoDia([
  sac({ criado_em: hoje }),
  sac({ criado_em: ontem, status: "VENDIDO", pago_em: hoje, valor_pago: 70 }),
  sac({ criado_em: ontem, status: "ENTREGUE", pago_em: ontem, valor_pago: 30, entregue_em: hoje }),
  sac({ origem: "orcamento", criado_em: hoje }),
], new Date("2026-10-28T15:00:00Z"));
eq(dia, { separadas: { n: 1, valor: 100 }, pagas: { n: 1, valor: 70 }, entregues: 1 }, "separado/pago/entregue só de hoje");
const rel = porCliente([
  sac({ cliente_nome: "Ana", cliente_whatsapp: "5591900000001" }),
  sac({ cliente_nome: "Ana", cliente_whatsapp: "(55) 91 90000-0001", status: "VENDIDO", valor_pago: 70 }),
  sac({ cliente_nome: "Bia", status: "ENTREGUE", valor_pago: 30 }),
  sac({ cliente_nome: "Caio", status: "CANCELADO" }),
  sac({ cliente_nome: "Dani", validade: "2026-10-27T00:00:00Z" }),
], agora);
eq(rel.map((c) => c.nome), ["Ana", "Bia"], "agrupa por WhatsApp, ignora cancelada e vencida, ordena por valor");
eq([rel[0].sacolas, rel[0].aPagar, rel[0].pago, rel[0].aEntregar], [2, 100, 70, 1], "totais da Ana (a pagar, pago, a entregar)");
