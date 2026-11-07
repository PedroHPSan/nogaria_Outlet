// Teste das regras puras das campanhas (campanhasCore). Rode: npm run test:campanhas
import assert from "node:assert/strict";
import { adicionarItem, mensagemCobranca, totaisComDecisao } from "../src/lib/sacolasCore.js";
import { brasiliaParaIso, isoParaBrasilia, validarCampanha, statusCampanha, rotuloRegra, contagem, conflitosDoErro, resumoSimulacao, offsetServidor, msAte, faseCampanha, fmtPrazo, mensagemQuero, aplicarPromo, promoQueTerminaPrimeiro, aplicarPromoSacola, promoVencida, pendentesDoErro, resumoResultado, avisoCampanhaItem, linkCampanha, textoGrupoCampanha } from "../src/lib/campanhasCore.js";

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

console.log("página pública: relógio do servidor");
const srv = "2026-11-10T12:00:00Z";
const cli = Date.parse("2026-11-10T11:50:00Z"); // relógio do cliente atrasado 10 min
const off = offsetServidor(srv, cli);
eq(off, 600000, "offset = servidor − cliente");
const camp = { nome: "Semana", inicio_em: "2026-11-10T10:00:00Z", fim_em: "2026-11-10T12:30:00Z" };
eq(msAte(camp.fim_em, off, cli), 30 * 60000, "restam 30 min no relógio do servidor (não 40)");
eq(faseCampanha(camp, off, cli), "ativa", "ativa");
eq(faseCampanha(camp, off, cli + 31 * 60000), "encerrada", "encerra no zero do servidor");
eq(faseCampanha({ ...camp, inicio_em: "2026-11-10T12:10:00Z" }, off, cli), "agendada", "agendada antes do início");
eq(faseCampanha(camp, 0, cli), "ativa", "sem offset também funciona");
eq(fmtPrazo("2026-11-16T02:59:00Z"), "15/11 às 23:59", "prazo no horário de Brasília");
const msg = mensagemQuero({ sku: "A1", produto: "Camisa", preco: 70, preco_cheio: 100 }, camp, "https://x/promo/abc");
ok(/Camisa \(A1\) por R\$\s70,00 \(de R\$\s100,00\)/.test(msg) && /Semana/.test(msg) && /até 10\/11 às 09:30/.test(msg), "mensagem leva o preço promocional e o prazo");
ok(!/\(de /.test(mensagemQuero({ sku: "A1", produto: "Camisa", preco: 70 }, camp)), "sem preço cheio não inventa 'de'");

console.log("promo nas páginas existentes");
const base = { sku: "A1", produto: "Camisa", preco: 100 };
eq(aplicarPromo(base, { preco: 80, preco_cheio: 100, desconto_pct: 20 }), { ...base, preco: 80, preco_cheio: 100, desconto_pct: 20 }, "aplica preço, 'de' e %");
eq(aplicarPromo(base, null), base, "sem promo não mexe");
eq(aplicarPromo(base, { preco: 100, preco_cheio: 100, desconto_pct: 0 }), base, "promo que não baixa o preço é ignorada");
eq(aplicarPromo(base, { preco: 0, preco_cheio: 100 }), base, "preço promocional inválido é ignorado");
eq(promoQueTerminaPrimeiro({ a: { fim_em: "2026-11-20T00:00:00Z" }, b: { fim_em: "2026-11-15T00:00:00Z" } }).fim_em, "2026-11-15T00:00:00Z", "a que termina primeiro");
eq(promoQueTerminaPrimeiro({}), null, "sem promoções");

console.log("sacola com promoção");
const pe = { campanha_id: "c1", campanha_nome: "Semana", campanha_fim: "2026-11-15T02:59:00Z", preco: 80, preco_cheio: 100 };
const prod = { sku: "A1", produto: "Camisa", preco_ideal: 100 };
const [com] = adicionarItem([], prod, pe, "2026-11-10T12:00:00Z");
eq([com.preco, com.preco_cheio, com.preco_promo, com.campanha_id, com.entrou_em], [80, 100, 80, "c1", "2026-11-10T12:00:00Z"], "item entra com preço promocional e 'de' congelado");
const [sem] = adicionarItem([], prod, null);
eq([sem.preco, sem.campanha_id], [100, undefined], "sem campanha entra no preço normal");
eq(aplicarPromoSacola({ sku: "X", preco: 100 }, { campanha_id: "c1", preco: 100, preco_cheio: 100 }), { sku: "X", preco: 100 }, "promo que não baixa o preço não marca o item");
ok(mensagemCobranca({ itens: [com], desconto_pct: 0 }).includes("de R$ 100 por R$ 80"), "cobrança mostra de/por");
ok(!mensagemCobranca({ itens: [sem], desconto_pct: 0 }).includes(" de R$"), "sem promo, mensagem igual à de sempre");
ok(promoVencida(com, new Date("2026-11-16T00:00:00Z")), "promo vencida depois do fim");
ok(!promoVencida(com, new Date("2026-11-14T00:00:00Z")), "promo no prazo não está vencida");
ok(!promoVencida({ ...com, campanha_decisao: "manteve_promo" }, new Date("2026-11-16T00:00:00Z")), "já decidida não pergunta de novo");
ok(!promoVencida(sem), "item sem campanha nunca vence");
const pend = [{ sku: "A1", preco_promo: 80, preco_cheio_atual: 100 }];
eq(totaisComDecisao([com, { sku: "B", preco: 50 }], 0, pend), { promo: 130, cheio: 150, diferenca: 20 }, "total mantendo × cobrando cheio");
eq(totaisComDecisao([com], 10, pend), { promo: 72, cheio: 90, diferenca: 18 }, "o desconto da sacola vale nos dois casos");
eq(pendentesDoErro({ message: "DECISAO_CAMPANHA", details: JSON.stringify(pend) }), pend, "lê os pendentes do erro");
eq(pendentesDoErro({ message: "outro" }), null, "outro erro não é decisão");
eq(pendentesDoErro({ message: "DECISAO_CAMPANHA", details: "lixo" }), [], "detalhe ilegível não quebra");

console.log("resultado");
const rr = {
  itens_na_campanha: 10,
  por_decisao: { no_prazo: { itens: 3, receita: 240, desconto: 60 }, manteve_promo: { itens: 1, receita: 160, desconto: 40 }, preco_cheio: { itens: 1, receita: 200, desconto: 0 } },
  sacolas_abertas: { sacolas: 2, itens: 3, valor: 500, desconto_comprometido: 125.5 }, nao_vendidos: 4, fora_da_sacola: { itens: 1, receita: 48 },
};
const sr = resumoResultado(rr);
eq([sr.vendidos, sr.receita, sr.desconto], [5, 600, 100], "vendidos, receita e desconto concedido");
eq([sr.conversaoPct, sr.depoisDoFim], [50, 2], "conversão e vendas depois do fim");
eq([sr.comprometido, sr.sacolasAbertas, sr.itensEmSacola, sr.naoVendidos, sr.foraDaSacola, sr.receitaFora], [125.5, 2, 3, 4, 1, 48], "comprometido, sacolas, não vendidos e fora da sacola");
eq(resumoResultado(null), null, "sem dados");
eq(resumoResultado({ itens_na_campanha: 0, por_decisao: {} }).conversaoPct, 0, "campanha vazia não divide por zero");

console.log("aviso na ficha do item");
const linha = (o) => ({ preco_cheio: 100, desconto_pct: 20, campanhas: { nome: "Semana", status: "PUBLICADA", inicio_em: "2026-11-09T00:00:00Z", fim_em: "2026-11-20T00:00:00Z", ...o } });
const ag = new Date("2026-11-10T12:00:00Z");
eq(avisoCampanhaItem([linha({})], ag).ativa, true, "campanha ativa avisa");
eq(avisoCampanhaItem([linha({ inicio_em: "2026-11-15T00:00:00Z" })], ag).ativa, false, "agendada também avisa");
eq(avisoCampanhaItem([linha({ fim_em: "2026-11-10T00:00:00Z" })], ag), null, "encerrada não avisa");
eq(avisoCampanhaItem([linha({ status: "CANCELADA" })], ag), null, "cancelada não avisa");
eq(avisoCampanhaItem([{ ...linha({}), desconto_pct: 0 }], ag), null, "0% (excluído) não avisa");
eq(avisoCampanhaItem([], ag), null, "sem campanha");

console.log("divulgação no grupo");
eq(linkCampanha("abc123", "https://outlet.exemplo/"), "https://outlet.exemplo/promo/abc123", "link da campanha");
eq(textoGrupoCampanha({ nome: "Semana do Cliente", fim_em: "2026-11-16T02:59:00Z" }, "https://x/promo/abc", 30), "🔥 *Semana do Cliente*\nAté 30% OFF · válido até 15/11 às 23:59\nToque para ver as peças:\nhttps://x/promo/abc", "texto para o grupo com % e prazo");
ok(!textoGrupoCampanha({ nome: "X", fim_em: "2026-11-16T02:59:00Z" }, "https://x", 0).includes("OFF"), "sem % não inventa 'OFF'");
