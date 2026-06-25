// Teste do normalizador derivarPreco (precoView.js). Rode: npm run test:precoview
import assert from "node:assert/strict";
import { derivarPreco } from "../src/lib/precoView.js";

let passou = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, ~${b})`); passou++; console.log(`  ok  ${msg}`); };

// Styler: ref novo 150, Novo lacrado, caixa LEVE, risco MEDIO → ~111.
const it = { estado: "Novo", preco_ref_novo: 150, cond_embalagem: "LEVE", preco_ref_fonte: "IA:claude", preco_ref_confianca: "MEDIA", preco_ideal: 120 };
const d = derivarPreco(it, {}, undefined);

console.log("derivação fecha a conta (produto dos fatores = recomendado)");
near(d.recomendado, 111.38, 0.5, "recomendado ≈ 111 (Novo + caixa leve)");
const refEff = d.derivacao[0].valor;
const fCond = d.derivacao[1].fator, fEmb = d.derivacao[2].fator, fRisco = d.derivacao[3].fator;
near(refEff * fCond * fEmb * fRisco, d.recomendado, 0.02, "refEff × fCond × fEmb × fRisco = recomendado");
eq(d.derivacao[3].valor, d.recomendado, "último passo da derivação = recomendado");
eq(d.derivacao.length, 4, "4 passos: Referência → Condição → Embalagem → Risco");
eq(d.derivacao[2].detalhe, "Levemente avariada", "rótulo da embalagem legível");

console.log("\ncustos da plataforma visíveis (não dobram a conta)");
const e = d.economia;
near(e.custoTaxa, d.recomendado * e.taxa, 0.02, "custoTaxa = recomendado × takeRate");
near(e.custoPlataforma, e.custoTaxa + e.fixo, 0.02, "custoPlataforma = comissão + tarifa fixa");
// A quebra fecha: receita − (taxa+reserva+frete+embalagem+fixo+custo) = lucro do motor.
const reconc = e.receita - e.custoTaxa - e.custoReserva - e.frete - e.custoEmbalagem - e.fixo - e.custo;
near(reconc, e.lucro, 0.02, "receita − custos = lucro (quebra fecha com o motor)");

console.log("\nlucro/margem ao vivo + memória de cálculo");
near(d.lucroEm(d.recomendado), d.economia.lucro, 0.05, "lucroEm(recomendado) = lucro do motor");
near(d.margemEm(d.recomendado), d.economia.margem, 0.005, "margemEm(recomendado) = margem do motor");
near(d.margemEm(d.piso), d.economia.margemMin, 0.005, "margemEm(piso) = margem mínima");
eq(d.lucroEm(0), null, "lucroEm(0) = null");
eq(d.memoria.piso.resultado, d.piso, "memória do piso fecha no piso");
eq(d.memoria.teto[d.memoria.teto.length - 1].valor, d.recomendado, "memória do teto fecha no recomendado");
near(d.memoria.piso.custosDiretos, d.economia.custo + d.economia.frete + d.economia.custoEmbalagem + d.economia.fixo, 0.02, "custos diretos = custo+frete+embalagem+fixo");
eq(d.memoria.teto.every((p) => p.ajuda), true, "todo passo da memória do teto tem ajuda em PT");

console.log("\nmanual + referência + flags");
eq(d.manual, 120, "manual reflete preco_ideal (não preco_sugerido)");
eq(d.referencia.confianca, "MEDIA", "confiança da referência");
eq(d.referencia.fonte, "IA:claude", "fonte da referência");
// preco_ideal abaixo do piso → flag de erro
const abaixo = derivarPreco({ ...it, preco_ideal: 1 }, {}, undefined);
eq(abaixo.flags.some((f) => f.tipo === "erro"), true, "preço 1 < piso → flag de erro");
// sem preco_ideal → manual null, sem flag
const semManual = derivarPreco({ ...it, preco_ideal: null }, {}, undefined);
eq(semManual.manual, null, "sem preco_ideal → manual null");
eq(semManual.flags.length, 0, "sem manual → sem flags");
// NUNCA usa preco_sugerido como manual
eq(derivarPreco({ estado: "Novo", preco_ref_novo: 150, preco_sugerido: 99 }, {}, undefined).manual, null, "preco_sugerido NÃO vira manual");

console.log(`\n${passou} asserções OK`);
