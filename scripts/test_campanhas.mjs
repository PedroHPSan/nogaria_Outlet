// Teste das regras puras das campanhas (campanhasCore). Rode: npm run test:campanhas
import assert from "node:assert/strict";
import { brasiliaParaIso, isoParaBrasilia, validarCampanha, statusCampanha, rotuloRegra, contagem, conflitosDoErro, resumoSimulacao } from "../src/lib/campanhasCore.js";

const ok = (c, msg) => { assert.ok(c, msg); console.log(`  ok  ${msg}`); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); console.log(`  ok  ${msg}`); };
const agora = new Date("2026-11-10T12:00:00Z");

console.log("horário de Brasília");
eq(brasiliaParaIso("2026-11-15T23:59"), "2026-11-16T02:59:00.000Z", "23:59 de Brasília = 02:59Z do dia seguinte");
eq(isoParaBrasilia("2026-11-16T02:59:00.000Z"), "2026-11-15T23:59", "ida e volta");
eq(brasiliaParaIso(""), null, "vazio vira null");

console.log("validação");
const form = { nome: "Semana do Cliente", inicio: "2026-11-11T08:00", fim: "2026-11-15T23:59" };
const geral = { tipo: "geral", alvo: "", canal: "", desconto_pct: "20" };
eq(validarCampanha(form, [geral], agora), [], "campanha válida");
ok(validarCampanha({ ...form, nome: "ab" }, [geral], agora).length === 1, "nome curto");
ok(validarCampanha({ ...form, fim: "2026-11-11T07:00" }, [geral], agora).some((m) => /depois do início/.test(m)), "fim antes do início");
ok(validarCampanha({ ...form, inicio: "2026-11-01T08:00", fim: "2026-11-05T08:00" }, [geral], agora).some((m) => /já passou/.test(m)), "fim no passado");
ok(validarCampanha(form, [], agora).some((m) => /ao menos uma regra/.test(m)), "sem regras");
ok(validarCampanha(form, [{ ...geral, desconto_pct: "95" }], agora).some((m) => /0% e 90%/.test(m)), "desconto acima de 90%");
ok(validarCampanha(form, [{ ...geral, desconto_pct: "" }], agora).some((m) => /informe o desconto/.test(m)), "desconto vazio");
ok(validarCampanha(form, [{ ...geral, desconto_pct: "0" }], agora).length === 0, "0% é permitido (exclui)");
ok(validarCampanha(form, [{ tipo: "grupo", alvo: "", canal: "", desconto_pct: "10" }], agora).some((m) => /escolha o alvo/.test(m)), "alvo obrigatório fora do geral");
ok(validarCampanha(form, [geral, { ...geral }], agora).some((m) => /repetida/.test(m)), "regra repetida");
ok(validarCampanha(form, [geral, { ...geral, canal: "instagram" }], agora).length === 0, "mesmo alvo em canal diferente não é repetida");

console.log("estado");
const c = (o) => ({ status: "PUBLICADA", inicio_em: "2026-11-09T00:00:00Z", fim_em: "2026-11-12T00:00:00Z", ...o });
eq(statusCampanha(c({ status: "RASCUNHO" }), agora), "rascunho", "rascunho");
eq(statusCampanha(c({}), agora), "ativa", "ativa");
eq(statusCampanha(c({ inicio_em: "2026-11-11T00:00:00Z" }), agora), "agendada", "agendada");
eq(statusCampanha(c({ fim_em: "2026-11-10T11:00:00Z" }), agora), "encerrada", "encerrada pelo prazo");
eq(statusCampanha(c({ status: "CANCELADA" }), agora), "cancelada", "cancelada");

console.log("rótulos e contagem");
eq(rotuloRegra({ tipo: "grupo", alvo: "Vestuário", canal: "", desconto_pct: 30 }), "Categoria: Vestuário → 30% off", "regra de categoria");
eq(rotuloRegra({ tipo: "geral", alvo: null, canal: "instagram", desconto_pct: 0 }, { instagram: "Instagram" }), "Todos os itens · só Instagram → fora da campanha", "0% com canal");
eq(contagem(2 * 86400000 + 4 * 3600000 + 13 * 60000 + 22000), "2d 04:13:22", "contagem com dias");
eq(contagem(3725000), "01:02:05", "contagem sem dias");
eq(contagem(0), "encerrada", "zero = encerrada");

console.log("conflito de SKU");
const det = JSON.stringify([{ sku: "A1", campanha: "Semana", campanha_id: "x" }, { sku: "A2", campanha: "Semana", campanha_id: "x" }, { sku: "A9", campanha: "Outra", campanha_id: "y" }]);
eq(conflitosDoErro({ message: "CONFLITO_SKU", details: det }), [{ campanha: "Semana", skus: ["A1", "A2"] }, { campanha: "Outra", skus: ["A9"] }], "agrupa SKUs por campanha");
eq(conflitosDoErro({ message: "outro erro" }), null, "outro erro não é conflito");
eq(conflitosDoErro({ message: "CONFLITO_SKU", details: "lixo" }), [], "detalhe ilegível não quebra");

console.log("simulação");
const linhas = [
  { sku: "A", preco_cheio: 100, preco: 80, desconto_pct: 20, regra_tipo: "geral" },
  { sku: "B", preco_cheio: 200, preco: 140, desconto_pct: 30, regra_tipo: "grupo", conflito_campanha: "z" },
  { sku: "C", preco_cheio: 50, preco: 50, desconto_pct: 0, regra_tipo: "item" },
  { sku: "D", preco_cheio: 100, preco: 90, desconto_pct: 10, regra_tipo: "geral" },
];
const margens = new Map([["A", { antes: 30, depois: 10 }], ["B", { antes: 20, depois: -5 }], ["D", { semCusto: true }]]);
const s = resumoSimulacao(linhas, margens);
eq([s.itens, s.excluidos], [3, 1], "3 cobertos, 1 excluído (0%)");
eq([s.cheio, s.promo, s.desconto], [400, 310, 90], "receita cheia, com desconto e desconto total");
eq(s.descontoMedioPct, 22.5, "desconto médio ponderado");
eq(s.porRegra, { geral: 2, grupo: 1 }, "contagem por regra");
eq([s.comCusto, s.semCusto, s.lucroAntes, s.lucroDepois], [2, 1, 50, 5], "lucro antes/depois só com custo");
eq(s.abaixoPiso, ["B"], "item com lucro negativo vai para abaixo do piso");
eq(s.conflitos, 1, "conta itens em conflito");
eq(s.cenarios.map((x) => x.receita), [77.5, 155, 310], "cenários 25/50/100%");
eq(resumoSimulacao([]).itens, 0, "lista vazia");
