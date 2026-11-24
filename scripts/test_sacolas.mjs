// Teste das regras puras da sacola de WhatsApp (sacolasCore + transições). Rode: npm run test:sacolas
import assert from "node:assert/strict";
import { podeTransitar, statusEfetivo, prazoSacola } from "../src/lib/orcamentosCore.js";
import { PRAZOS_RENOVACAO, rotuloPrazo, mesmoCliente, sacolaAbertaDe, adicionarItem, removerItem, resumoSacolas, mensagemCobranca, linkCobranca, resumoDoDia, porCliente, financeiroDaSacola, situacaoParcelas, proximaParcela, gerarPlano, taxaLiquida, recebimentosDoDia, FORMAS_PAGAMENTO } from "../src/lib/sacolasCore.js";

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

console.log("renovação");
eq(PRAZOS_RENOVACAO, [1, 3, 7, 15, 30], "prazos oferecidos para reabrir/estender");
eq([rotuloPrazo(1), rotuloPrazo(7)], ["1 dia", "7 dias"], "rótulos");
eq(statusEfetivo(sac({ validade: "2026-10-27T00:00:00Z" }), agora), "EXPIRADO", "vencida é EXPIRADO (reabrir aparece)");
eq(statusEfetivo(sac({ validade: new Date(+agora + 7 * 86400000).toISOString() }), agora), "ABERTA", "prazo novo de 7 dias volta a ABERTA");
ok(new Date(prazoSacola(agora, 30)) - agora === 30 * 86400000, "prazoSacola aceita dias a partir de agora");

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
eq(r, { abertas: 2, aReceber: 140, vencendo: 1, pagasSemEntrega: 1, recebido: 100, vencido: 0 }, "contagens e valores");

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

console.log("pagamento parcial e saldo");
const pg = (valor, extra = {}) => ({ valor, forma: "Pix", recebido_em: "2026-10-28T13:00:00Z", ...extra });
const parcial = sac({ itens: [{ sku: "A", preco: 200 }], pagamentos: [pg(80), pg(20, { estornado_em: "2026-10-28T14:00:00Z", estorno_motivo: "erro" })] });
eq(financeiroDaSacola(parcial, agora), { total: 200, pago: 80, saldo: 120, devendo: true, situacao: "PARCIAL" }, "estornado não conta; saldo = total − recebido");
eq(financeiroDaSacola(sac({ pagamentos: [] }), agora).situacao, "NAO_PAGO", "sem pagamento = não pago");
eq(financeiroDaSacola(sac({ pagamentos: [pg(100)] }), agora), { total: 100, pago: 100, saldo: 0, devendo: false, situacao: "QUITADO" }, "quitado");
eq(financeiroDaSacola(sac({ status: "VENDIDO", valor_pago: 40 }), agora).devendo, false, "sacola antiga com valor menor, sem liberação, não vira dívida");
eq(financeiroDaSacola(sac({ status: "VENDIDO", liberada_com_saldo_em: "2026-10-28T10:00:00Z", pagamentos: [pg(40)] }), agora).saldo, 60, "fiado: saldo segue em aberto após a baixa");
eq(resumoSacolas([parcial], agora).aReceber, 120, "a receber usa o saldo, não o total");
eq(resumoSacolas([parcial], agora).recebido, 80, "recebido soma o parcial da ABERTA");
eq(statusEfetivo(sac({ pagamentos: [pg(1)], validade: "2036-10-28T00:00:00Z" }), agora), "ABERTA", "validade longa (com pagamento) não vence");
const fiado = sac({ status: "ENTREGUE", liberada_com_saldo_em: "2026-10-28T10:00:00Z", cliente_nome: "Cleuma", itens: [{ sku: "A", preco: 315.34 }], pagamentos: [pg(100)] });
const rel2 = porCliente([fiado, sac({ cliente_nome: "Cleuma", pagamentos: [pg(30)] })], agora);
eq([rel2[0].pago, rel2[0].aPagar], [130, 215.34 + 70], "por cliente: pago e deve (fiado + parcial)");

console.log("crediário: parcelas");
const parc = [{ numero: 1, valor: 100, vencimento: "2026-10-20" }, { numero: 2, valor: 100, vencimento: "2026-11-20" }, { numero: 3, valor: 100, vencimento: "2026-12-20" }];
eq(situacaoParcelas(parc, 120, agora).map((p) => [p.estado, p.pago, p.aberto]), [["PAGA", 100, 0], ["PARCIAL", 20, 80], ["ABERTA", 0, 100]], "pagamento abate da parcela mais antiga")
eq(situacaoParcelas(parc, 0, agora).map((p) => p.estado), ["VENCIDA", "ABERTA", "ABERTA"], "sem pagamento: a antiga venceu");
eq(proximaParcela(situacaoParcelas(parc, 100, agora)).numero, 2, "próxima parcela em aberto");
eq(situacaoParcelas(parc, 300, agora).every((p) => p.estado === "PAGA"), true, "tudo pago");
eq(gerarPlano({ saldo: 100, n: 3, primeiroVencimento: "2026-11-30", intervalo: 30 }), [{ valor: 33.34, vencimento: "2026-11-30" }, { valor: 33.33, vencimento: "2026-12-30" }, { valor: 33.33, vencimento: "2027-01-29" }], "divide em 3 (centavos na 1ª) a cada 30 dias");
eq(gerarPlano({ saldo: 90, n: 2, primeiroVencimento: "2026-01-31", intervalo: "mes" }).map((p) => p.vencimento), ["2026-01-31", "2026-02-28"], "mensal respeita fim de mês");
const comEntrada = gerarPlano({ saldo: 120, n: 2, primeiroVencimento: "2026-11-30", pago: 80, hoje: agora });
eq([comEntrada[0].valor, comEntrada.reduce((a, p) => a + p.valor, 0)], [80, 200], "entrada já paga vira a 1ª parcela e a soma fecha o total");
const msgParc = mensagemCobranca(sac({ cliente_nome: "Cleuma", itens: [{ sku: "A", produto: "Fone", preco: 300 }], pagamentos: [pg(100)], parcelas: [{ numero: 1, valor: 100, vencimento: "2026-11-20" }, { numero: 2, valor: 200, vencimento: "2026-12-20" }] }));
ok(msgParc.includes("já recebi R$ 100") && msgParc.includes("falta R$ 200") && msgParc.includes("Próxima parcela: R$ 200 em 20/12"), "cobrança cita o saldo e a próxima parcela");

console.log("formas e fluxo de caixa");
eq(FORMAS_PAGAMENTO, ["Pix", "Dinheiro", "Débito", "Crédito", "Transferência", "Outro"], "formas oferecidas");
eq(taxaLiquida(100, 4.5), 95.5, "valor líquido do cartão");
const rec = recebimentosDoDia([
  sac({ pagamentos: [pg(50), pg(30, { forma: "Crédito", valor_liquido: 28.8 }), pg(99, { recebido_em: "2026-10-27T13:00:00Z" }), pg(10, { estornado_em: "2026-10-28T14:00:00Z", estorno_motivo: "x" })] }),
  sac({ origem: "orcamento", pagamentos: [pg(500)] }),
], new Date("2026-10-28T15:00:00Z"));
eq(rec, { n: 2, total: 80, liquido: 78.8, porForma: { Pix: 50, Crédito: 30 } }, "recebido hoje por forma, só ativos, com líquido");
