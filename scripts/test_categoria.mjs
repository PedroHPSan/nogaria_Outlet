// Teste de categorização/classe (JS puro, sem dependências de banco).
// Rode: node scripts/test_categoria.mjs   (ou: npm run test:categoria)
import assert from "node:assert/strict";
import { sugerirCategoria } from "../src/lib/categorizar.js";
import { classeAutomatica } from "../src/lib/classificacao.js";

let passou = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

// Universo de categorias disponível na triagem (subset de pricing_grupo).
const CATS = [
  "Smartphone", "Acessórios celular/info", "Carregadores/Acessórios eletrônicos",
  "Notebook", "Fones de ouvido", "Ferramentas", "Diversos",
];

console.log("Pré-filtro de acessório (não herda a categoria do produto-pai)");

// Capa/película/skin de celular → Acessório, NUNCA Smartphone (o token de marca puxaria).
eq(sugerirCategoria("Capa Silicone iPhone 13", CATS), "Acessórios celular/info",
  "Capa iPhone → Acessórios celular/info (não Smartphone)");
eq(sugerirCategoria("Película de vidro Galaxy S23", CATS), "Acessórios celular/info",
  "Película Galaxy → Acessórios celular/info (não Smartphone)");
eq(sugerirCategoria("Carregador turbo Xiaomi 67W", CATS), "Carregadores/Acessórios eletrônicos",
  "Carregador Xiaomi → Carregadores/Acessórios eletrônicos (não Smartphone)");
eq(sugerirCategoria("Cabo USB tipo C Motorola", CATS), "Carregadores/Acessórios eletrônicos",
  "Cabo USB-C → Carregadores/Acessórios eletrônicos (não Smartphone)");

// O aparelho de verdade ainda casa com Smartphone.
eq(sugerirCategoria("iPhone 13 128GB", CATS), "Smartphone",
  "iPhone (aparelho) → Smartphone");
eq(sugerirCategoria("Smartphone Galaxy S23 Ultra", CATS), "Smartphone",
  "Galaxy (aparelho) → Smartphone");

console.log("\nPreço manda na classe automática (categoria é só fallback sem preço)");

const params = { grupos: { Smartphone: { classe: "A+" } } };

// Item barato com grupo herdado "Smartphone": o preço (R$25) manda → C, não A+.
eq(classeAutomatica({ grupo: "Smartphone", preco_ideal: 25 }, params).classe, "C",
  "R$25 com grupo Smartphone → C (preço manda)");
// Item caro de verdade → A+ pelo preço.
eq(classeAutomatica({ grupo: "Smartphone", preco_ideal: 1500 }, params).classe, "A+",
  "R$1500 → A+ (preço manda)");
// Sem preço: cai na âncora de categoria.
eq(classeAutomatica({ grupo: "Smartphone" }, params).classe, "A+",
  "Sem preço → classe da categoria (fallback)");
// Sem preço e sem categoria conhecida → C padrão.
eq(classeAutomatica({ grupo: "Inexistente" }, params).classe, "C",
  "Sem preço/categoria → C (padrão)");

console.log(`\n${passou} asserções OK`);
