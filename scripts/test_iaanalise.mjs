// Testes das funções PURAS do assistente de IA (iaAnalise.js). Rode: npm run test:iaanalise
import assert from "node:assert/strict";
import { construirSugestoes, separarSugestoes, patchVazios, montarAnalise } from "../src/lib/iaAnalise.js";

let passou = 0;
const ok = (c, msg) => { assert.ok(c, msg); passou++; console.log(`  ok  ${msg}`); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

const iaData = {
  titulo_anuncio: "Furadeira Bosch GSB 13 RE", descricao_anuncio: "Furadeira de impacto...",
  marca: "Bosch", modelo: "GSB 13 RE", grupo: null, ncm: null, voltagem: "220V", cor: null,
  dimensoes_estimadas: { comprimento_cm: 30, largura_cm: 8, altura_cm: 20, peso_kg: 1.8 },
  preco_ref_novo: 300, preco_ref_usado: 180, preco_ref_confianca: "MEDIA",
  pontos: ["potente", "com maleta"], palavras_chave: "furadeira, impacto",
  ficha_tecnica: [{ atributo: "Potência", valor: "750W" }],
  campos_faltantes: ["ncm", "cor"], observacoes: "Confirme a voltagem na etiqueta.", usou_foto: false,
};

console.log("construirSugestoes filtra nulos");
const sug = construirSugestoes(iaData, {});
ok(sug.some((s) => s.k === "titulo_anuncio"), "inclui título");
ok(!sug.some((s) => s.k === "grupo"), "exclui grupo (null)");
ok(!sug.some((s) => s.k === "cor"), "exclui cor (null)");

console.log("separarSugestoes é não-destrutivo");
const item = {
  titulo_anuncio: "Meu título manual", marca: "", modelo: null, voltagem: null,
  comprimento_cm: null, largura_cm: null, altura_cm: null, peso_real_kg: null,
  preco_ref_novo: null, preco_ref_usado: null, bullet_points: null, palavras_chave: "", ncm: null,
};
const { vazias, preenchidas } = separarSugestoes(sug, item);
ok(preenchidas.some((s) => s.k === "titulo_anuncio"), "título já preenchido vira sugestão manual");
ok(vazias.some((s) => s.k === "marca"), "marca vazia é auto-aplicável");
ok(vazias.some((s) => s.k === "dimensoes"), "dimensões todas vazias são auto-aplicáveis");

console.log("dimensões parcialmente preenchidas não são auto");
const sep2 = separarSugestoes(sug, { ...item, altura_cm: 10 });
ok(sep2.preenchidas.some((s) => s.k === "dimensoes"), "com uma dimensão preenchida, vira sugestão");

console.log("patchVazios mescla só as vazias");
const patch = patchVazios(vazias);
eq(patch.marca, "Bosch", "patch aplica marca");
ok(!("titulo_anuncio" in patch), "patch não inclui o título já preenchido");

console.log("montarAnalise monta o snapshot durável");
const analise = montarAnalise(iaData, sug, vazias.map((s) => s.k), { em: "2026-07-10T00:00:00Z", por: "eu@x" });
eq(analise.campos_faltantes, ["ncm", "cor"], "guarda campos_faltantes");
eq(analise.observacoes, "Confirme a voltagem na etiqueta.", "guarda o diagnóstico");
ok(analise.sugestoes.every((s) => "k" in s && "label" in s && "val" in s && "patch" in s), "sugestoes guardam {k,label,val,patch}");
ok(analise.aplicados.includes("marca"), "aplicados inclui marca");

console.log(`\n${passou} asserções OK`);
