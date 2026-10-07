// Teste de categorização/classe (JS puro, sem dependências de banco).
// Rode: node scripts/test_categoria.mjs   (ou: npm run test:categoria)
import assert from "node:assert/strict";
import { sugerirCategoria } from "../src/lib/categorizar.js";
import { classeAutomatica } from "../src/lib/classificacao.js";
import { aoTrocarCategoria } from "../src/lib/categoriaTroca.js";

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

console.log("\nNomes REAIS de produção que caíam em Smartphone (drift de categoria → preço, classe e rateio)");
const CATS2 = [...CATS, "Móveis", "Cama/Mesa/Banho", "Moto/Capacetes", "Bicicleta", "Relógios/Joias/Óculos"];
const ACC = "Acessórios celular/info", CAR = "Carregadores/Acessórios eletrônicos";
const casos = [
  ["Cabo Turbo Baseus P/ Iphone 20W Usb-C Lightning Power Off 2M Cor Azul", CAR], // NOG-120-098
  ["Capa Capinha + Pelicula 3D Para Samsung Galaxy Todos Modelos", ACC],
  ["3 Película De Vidro 3D Anti Impacto Para Samsung Galaxy A05", ACC],
  ["Capa Capinha Compatível Para Iphone Xr Silicone Aveludada Preto Lisa", ACC],
  ["Capinha Silicone Compativel Iphone 16/16Pro/Max +Película3D", ACC],
  ["Capa Capinha Compatível Com Galaxy M54 5G Aveludado Silicone", ACC],
  ["Kit Capa Capinha Case Para Galaxy Note 9 + Pelicula Transparente", ACC],
  ["Capa Película Compatível Com Samsung Galaxy Fit3 Rosé R390", ACC],
  ["Kit 5 Película Hidrogel Para Samsung Galaxy Smartwatch Todos 4-5-6-7 E", ACC],
  ["Capa Case Dexnor 360 Kickstand Galaxy S26 Ultra Verde", ACC],
  ["Kit Com 10 Carregadores Para Iphone X-Cell Mod. Xc-Ip5", CAR],
  ["Carregador Turbo 30W H'Maston Cb23 Usb-C Iphone 15/16 Branco", CAR],
  ["Capa Galaxy Tab A9 A11 Para Samsung 8,7 Polegadas Anti Impacto 3 Em 1", ACC],
];
for (const [nome, esperado] of casos) eq(sugerirCategoria(nome, CATS2), esperado, `${nome.slice(0, 48)}… → ${esperado}`);

console.log("\nAparelhos de verdade continuam Smartphone; 'capa' de outra coisa não vira acessório de celular");
eq(sugerirCategoria("Celular Moto G84 128gb", CATS2), "Smartphone", "Moto G84 (aparelho) → Smartphone");
eq(sugerirCategoria("Smartphone Samsung Galaxy A15 128Gb", CATS2), "Smartphone", "Galaxy A15 (aparelho) → Smartphone");
eq(sugerirCategoria("Capa de chuva moto", CATS2), null, "capa de chuva de moto não é acessório de celular");
eq(sugerirCategoria("Cabo de aço 3m", CATS2), null, "cabo de aço não é carregador");
eq(sugerirCategoria("Capa para sofá 3 lugares", CATS2), "Móveis", "capa de sofá → Móveis (não acessório de celular)");
eq(sugerirCategoria("Fone Bluetooth P/ Celular", CATS2), "Fones de ouvido", "fone 'para celular' → Fones (o alvo não vota)");
eq(sugerirCategoria("Bateria para Iphone 11", CATS2), null, "bateria 'para iPhone' não vira Smartphone");

console.log("\nTroca de categoria não deixa herança da categoria antiga (classe e preço-foto)");
const P2 = { grupos: { Smartphone: { classe: "A+", ancoraNovo: 1300 }, [ACC]: { classe: "C", ancoraNovo: 80 } }, config: { convNovoUsado: 0.6 } };
const cabo = { sku: "NOG-120-098", grupo: "Smartphone", classe: "A+", preco_novo_est: 1300, preco_ideal: 60 };
const t1 = aoTrocarCategoria(cabo, ACC, P2);
eq(t1.grupo, ACC, "troca o grupo");
eq(t1.preco_novo_est, null, "limpa o preco_novo_est que era a âncora do Smartphone (R$ 1.300)");
eq(t1.classe, "C", "classe A+ herdada do Smartphone vira C (preço R$ 60 manda)");
const t2 = aoTrocarCategoria({ ...cabo, preco_novo_est: 150 }, ACC, P2);
eq("preco_novo_est" in t2, false, "preço digitado à mão (≠ âncora antiga) é preservado");
const t3 = aoTrocarCategoria({ ...cabo, classe: "E" }, ACC, P2);
eq("classe" in t3, false, "classe E (condição) não é mexida");
const t4 = aoTrocarCategoria({ ...cabo, classe: "B" }, ACC, P2);
eq("classe" in t4, false, "classe B definida à mão (≠ da categoria antiga e do cálculo) é preservada");
eq(Object.keys(aoTrocarCategoria(cabo, "Smartphone", P2)).join(), "grupo", "mesma categoria: só devolve o grupo");

console.log(`\n${passou} asserções OK`);
