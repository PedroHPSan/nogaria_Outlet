// Teste das regras puras das campanhas (campanhasCore). Rode: npm run test:campanhas
import assert from "node:assert/strict";
import { textoWhatsApp, textoInstagram, legendaProduto, legendaCard } from "../src/lib/divulgacao.js";
import { cardProduto } from "../src/lib/cardCore.js";
import { resumoAuditoria, filtrarAuditoria, lerSkusColados, comRegrasDeItem, semRegraDeItem, msgErroCampanha, SITUACOES, ORDEM_SITUACOES, planejarPublicacaoCatalogo, historicoDoProduto } from "../src/lib/campanhasCore.js";
import { emPromo, pctPromo, prazoPromo } from "../src/lib/campanhasCore.js";
import { textoGrupo, tituloOg, montarPayloadOferta } from "../src/lib/ofertaCore.js";
import { textoGrupoEuro } from "../src/lib/precoEuro.js";
import { cardOgProduto } from "../src/lib/cardCore.js";
import { adicionarItem, mensagemCobranca, totaisComDecisao } from "../src/lib/sacolasCore.js";
import { brasiliaParaIso, isoParaBrasilia, validarCampanha, statusCampanha, rotuloRegra, contagem, conflitosDoErro, resumoSimulacao, offsetServidor, msAte, faseCampanha, fmtPrazo, mensagemQuero, aplicarPromo, promoQueTerminaPrimeiro, aplicarPromoSacola, promoVencida, pendentesDoErro, resumoResultado, avisoCampanhaItem, linkCampanha, textoGrupoCampanha, comPromo } from "../src/lib/campanhasCore.js";

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

console.log("link gerado pela tela do produto leva o preço da campanha");
const prodL = { sku: "NOG-1", produto: "Camisa Polo", preco_ideal: 100, estado: "Novo", marca: "X" };
const pL = { sku: "NOG-1", preco: 70, preco_cheio: 100, desconto_pct: 30, campanha_fim: "2026-11-16T02:59:00Z" };
const itL = comPromo(prodL, pL);
eq([itL.preco_ideal, itL.preco_cheio, itL.desconto_pct], [70, 100, 30], "comPromo troca o preço e guarda o 'de'");
eq(comPromo(prodL, null), prodL, "sem campanha o item fica intacto");
ok(tituloOg(itL).includes("R$ 70") && tituloOg(itL).includes("(de R$ 100)"), "título do preview: preço da campanha e o 'de'");
ok(!tituloOg(prodL).includes("(de "), "sem campanha o título é o de sempre");
const payL = montarPayloadOferta([itL], {});
eq(textoGrupo(payL, "https://x/p/abc", pL), `*${payL.titulo}*\n~R$ 100~ por *R$ 70* (-30%)\n🔥 Promoção até 15/11 às 23:59\nhttps://x/p/abc`, "texto do grupo: de riscado, por, % e prazo");
ok(textoGrupo(montarPayloadOferta([prodL], {}), "https://x/p/abc", null).includes("*R$ 100*"), "texto do grupo sem campanha: igual ao de sempre");
const euroT = textoGrupoEuro(payL, "https://x/p/abc", { taxa: 6, em: Date.parse("2026-11-10T12:00:00Z") }, pL);
ok(euroT.includes("de ~R$ 100,00~") && /70,00/.test(euroT), "texto em € parte do preço da campanha");
const cardL = cardOgProduto(itL, { mostrarPreco: true });
const txts = cardL.ops.filter((o) => o.k === "text").map((o) => o.s);
ok(txts.includes("R$ 70") && txts.includes("-30%") && txts.includes("DE R$ 100"), "card: preço da campanha, selo -30% e 'DE' riscado");
ok(cardL.ops.some((o) => o.k === "rect" && o.h === 4), "card: linha do riscado");
ok(!cardOgProduto(comPromo(prodL, null), { mostrarPreco: true }).ops.some((o) => o.k === "text" && /^-\d+%$/.test(o.s)), "card sem campanha não tem selo");

console.log("cards e legendas do Instagram/WhatsApp com a campanha");
const pI = { sku: "NOG-1", preco: 70, preco_cheio: 100, desconto_pct: 30, campanha_fim: "2026-11-16T02:59:00Z", campanha_nome: "Semana" };
const iP = comPromo({ sku: "NOG-1", produto: "Camisa Polo", preco_ideal: 100, estado: "Novo", marca: "X", grupo: "Vestuário" }, pI);
const iN = { sku: "NOG-2", produto: "Tênis", preco_ideal: 200, estado: "Novo", grupo: "Calçados" };
ok(emPromo(iP) && pctPromo(iP) === 30 && !emPromo(iN), "emPromo / pctPromo");
eq(prazoPromo([iN, iP]), "15/11 às 23:59", "prazo da campanha entre os itens");
eq(prazoPromo([iN]), null, "sem campanha, sem prazo");
const wp = textoWhatsApp([iP, iN], { titulo: "Semana" });
ok(wp.includes("~R$ 100~ *R$ 70* (-30%)") && wp.includes("*R$ 200*") && wp.includes("🔥 Promoção até 15/11 às 23:59"), "texto do WhatsApp: riscado, por, % e prazo; item sem campanha igual");
ok(!textoWhatsApp([iN], {}).includes("🔥"), "sem campanha nada muda no texto do WhatsApp");
const ig = textoInstagram([iP, iN], { titulo: "Semana" });
ok(ig.includes("de R$ 100 por R$ 70 (-30%)") && !ig.includes("~") && !ig.includes("*") && ig.includes("🔥 Promoção até 15/11 às 23:59"), "legenda do Instagram: 'de … por …' sem ~ nem *");
const lp = legendaProduto(iP, { contato: "Barbara" });
ok(lp.includes("De R$ 100 por R$ 70 (-30%)") && lp.includes("🔥 Promoção até 15/11 às 23:59"), "legenda de 1 produto com de/por e prazo");
ok(legendaProduto(iN, {}).includes("Por R$ 200") && !legendaProduto(iN, {}).includes("🔥"), "legenda de 1 produto sem campanha igual");
ok(legendaCard(iP).includes("de R$ 100 por R$ 70"), "legenda curta do card");
const cI = cardProduto(iP, "feed", {}).ops.filter((o) => o.k === "text").map((o) => o.s);
ok(cI.includes("R$ 70") && cI.includes("-30%") && cI.includes("DE R$ 100") && cI.some((s) => s.startsWith("PROMOÇÃO ATÉ 15/11")), "card do Instagram: preço, selo, DE riscado e prazo");
ok(!cardProduto(iN, "feed", {}).ops.some((o) => o.k === "text" && /^-\d+%$/.test(o.s)), "card do Instagram sem campanha: sem selo");
ok(!cardProduto(iP, "feed", { mostrarPreco: false }).ops.some((o) => o.k === "text" && o.s === "-30%"), "sem mostrar preço, nada de selo");

console.log("auditoria dos produtos da campanha");
const aud = [
  { sku: "A1", produto: "Camisa", grupo: "Vestuário", situacao: "na_campanha", no_catalogo: true, origem: "regra" },
  { sku: "A2", produto: "Saia", grupo: "Vestuário", situacao: "na_campanha", no_catalogo: false, origem: "manual" },
  { sku: "A3", produto: "Blusa", grupo: "Vestuário", situacao: "sem_preco", no_catalogo: false },
  { sku: "A4", produto: "Calça", grupo: "Vestuário", situacao: "indisponivel", no_catalogo: true },
  { sku: "A5", produto: "Tênis", grupo: "Calçados", situacao: "nao_incluida", no_catalogo: true },
];
const ra = resumoAuditoria(aud);
eq([ra.total, ra.naCampanha, ra.foraDoCatalogo, ra.manuais], [5, 2, 1, 1], "resumo: total, na campanha, fora do catálogo e manuais");
eq([ra.por.sem_preco, ra.por.indisponivel, ra.por.nao_incluida, ra.por.conflito], [1, 1, 1, 0], "resumo por situação");
eq(filtrarAuditoria(aud, { situacao: "na_campanha" }).map((l) => l.sku), ["A1", "A2"], "filtro por situação");
eq(filtrarAuditoria(aud, { busca: "tênis" }).map((l) => l.sku), ["A5"], "busca por nome");
eq(filtrarAuditoria(aud, { busca: "vestu", situacao: "sem_preco" }).map((l) => l.sku), ["A3"], "situação + busca");
ok(ORDEM_SITUACOES.every((k) => SITUACOES[k]?.length === 3), "toda situação tem rótulo, cor e explicação");
eq(lerSkusColados("nog-1-001, NOG-1-002;\nnog-1-001  x  NOG-9"), ["NOG-1-001", "NOG-1-002", "NOG-9"], "SKUs colados: maiúsculos, sem repetição e sem lixo curto");
eq(lerSkusColados(""), [], "SKUs vazio");
const rg = [{ tipo: "grupo", alvo: "Vestuário", canal: "", desconto_pct: "20" }, { tipo: "item", alvo: "NOG-1-001", canal: "", desconto_pct: "5" }, { tipo: "item", alvo: "NOG-1-002", canal: "instagram", desconto_pct: "9" }];
const rg2 = comRegrasDeItem(rg, ["NOG-1-001", "NOG-1-003"], 0);
eq(rg2.filter((r) => r.tipo === "item").map((r) => `${r.alvo}:${r.desconto_pct}:${r.canal || "*"}`), ["NOG-1-002:9:instagram", "NOG-1-001:0:*", "NOG-1-003:0:*"], "regra de item substitui a do mesmo SKU (sem canal) e preserva as de canal");
eq(semRegraDeItem(rg2, "nog-1-001").some((r) => r.alvo === "NOG-1-001"), false, "desfazer a exceção do item");
eq(msgErroCampanha({ message: "NENHUM_ITEM: nenhuma peça elegível" }), "nenhuma peça elegível", "erro de publicação sem o prefixo técnico");

console.log("publicar no catálogo as peças da campanha");
const audC = [
  { sku: "A1", produto: "Camisa", situacao: "na_campanha", no_catalogo: false },
  { sku: "A2", produto: "Saia", situacao: "na_campanha", no_catalogo: false },
  { sku: "A3", produto: "Blusa", situacao: "na_campanha", no_catalogo: true },
  { sku: "A4", produto: "Calça", situacao: "sem_preco", no_catalogo: false },
  { sku: "A5", produto: "Vestido", situacao: "na_campanha", no_catalogo: false },
];
const pl2 = planejarPublicacaoCatalogo(audC, { A1: { elegivel: true, motivos: [] }, A2: { elegivel: false, motivos: ["sem_foto", "sem_estado"] }, A3: { elegivel: true, motivos: [] }, A4: { elegivel: true, motivos: [] } });
eq(pl2.publicar, ["A1"], "publica só a que é da campanha, está fora do catálogo e é elegível");
eq(pl2.ficam.map((f) => `${f.sku}:${f.motivos.join("+")}`), ["A2:sem foto+sem condição (estado)", "A5:não avaliada"], "as demais ficam com o motivo em português");
eq(pl2.total, 3, "total = peças da campanha fora do catálogo");
ok(!pl2.publicar.includes("A4") && !pl2.publicar.includes("A3"), "nunca publica peça fora da campanha nem já publicada");
eq(planejarPublicacaoCatalogo([], {}).publicar, [], "sem peças, nada a publicar");

console.log("auditoria por produto (ficha do item)");
const agP = new Date("2026-11-10T12:00:00Z");
const linP = [
  { campanha_id: "c1", preco_cheio: 100, desconto_pct: 20, canal: "whatsapp", regra_tipo: "grupo", campanhas: { nome: "Black", inicio_em: "2026-11-07T17:30:00Z", fim_em: "2026-11-20T00:00:00Z", status: "PUBLICADA" } },
  { campanha_id: "c1", preco_cheio: 100, desconto_pct: 30, canal: "instagram", regra_tipo: "grupo", campanhas: { nome: "Black", inicio_em: "2026-11-07T17:30:00Z", fim_em: "2026-11-20T00:00:00Z", status: "PUBLICADA" } },
  { campanha_id: "c0", preco_cheio: 90, desconto_pct: 10, canal: "*", regra_tipo: "manual", campanhas: { nome: "Antiga", inicio_em: "2026-10-01T00:00:00Z", fim_em: "2026-10-05T00:00:00Z", status: "PUBLICADA" } },
];
const hp = historicoDoProduto(linP, [{ campanha_id: "c0", valor_vendido: 81, decisao: "no_prazo", origem_ref: "ORC-1" }], agP);
eq(hp.map((h) => `${h.nome}:${h.estado}`), ["Black:ativa", "Antiga:encerrada"], "mais recente primeiro, com o estado de cada campanha");
eq([hp[0].canais.join("|"), hp[0].desconto_pct, hp[0].preco_promo], ["whatsapp:20%|instagram:30%", 30, 70], "canais com % e o maior desconto");
eq([hp[1].origem, hp[1].venda?.valor_vendido, hp[1].preco_promo], ["manual", 81, 81], "inclusão manual e a venda dentro da campanha");
eq(historicoDoProduto([], []), [], "produto sem campanha");
eq(historicoDoProduto([{ ...linP[0], campanhas: { ...linP[0].campanhas, status: "CANCELADA" } }], [], agP)[0].estado, "cancelada", "campanha cancelada");
