// Rode: npm run test:webhook (Deno; sem rede/banco).
import assert from "node:assert/strict";
import { extrairEventos, interpretarTexto, motivoAmigavel } from "./whatsapp.ts";

Deno.test("interpretarTexto", () => {
  assert.deepEqual(interpretarTexto("QUERO nog-103-415"), { tipo: "quero", sku: "NOG-103-415" });
  assert.deepEqual(interpretarTexto("Eu quero o NOG-SL-001 por favor"), { tipo: "quero", sku: "NOG-SL-001" });
  assert.equal(interpretarTexto("NOG-103-415"), null); // só o código, sem intenção → humano
  assert.deepEqual(interpretarTexto("  sair "), { tipo: "sair" });
  assert.deepEqual(interpretarTexto("ENTRAR"), { tipo: "entrar" });
  assert.deepEqual(interpretarTexto("pedido a1b2c"), { tipo: "pedido", codigo: "A1B2C" });
  assert.deepEqual(interpretarTexto("#A1B2C"), { tipo: "pedido", codigo: "A1B2C" });
  assert.equal(interpretarTexto("oi, bom dia"), null);
  assert.equal(interpretarTexto("quero saber o preço"), null);
});

Deno.test("extrairEventos: texto, carrinho e statuses com custo", () => {
  const payload = { entry: [{ changes: [{ value: {
    contacts: [{ wa_id: "5591", profile: { name: "Ana" } }],
    messages: [
      { id: "wamid.1", from: "5591", type: "text", text: { body: "quero NOG-103-415" } },
      { id: "wamid.2", from: "5591", type: "order", order: { product_items: [{ product_retailer_id: "nog-103-001", quantity: 1 }] } },
    ],
    statuses: [{ id: "wamid.9", recipient_id: "5591", status: "delivered", pricing: { category: "utility", billable: true, pricing_model: "PMP" } }],
  } }] }] };
  const { mensagens, statuses } = extrairEventos(payload);
  assert.equal(mensagens.length, 2);
  assert.equal(mensagens[0].nome, "Ana");
  assert.equal(mensagens[0].texto, "quero NOG-103-415");
  assert.deepEqual(mensagens[1].itens, [{ sku: "NOG-103-001", quantidade: 1 }]);
  assert.deepEqual(statuses[0], { id: "wamid.9", para: "5591", status: "delivered", categoria: "utility", billable: true, pricingModel: "PMP" });
  assert.deepEqual(extrairEventos({}), { mensagens: [], statuses: [] });
});

Deno.test("motivoAmigavel não vaza códigos internos", () => {
  assert.equal(motivoAmigavel("NOG-1: já separado em ORC-0012 (whatsapp)."), "Esse item já está reservado para outra pessoa.");
  assert.equal(motivoAmigavel("NOG-1: fora de estoque."), "Esse item já foi vendido.");
  assert.match(motivoAmigavel("LIMITE_RESERVAS"), /limite de 3/);
  assert.match(motivoAmigavel("NAO_PUBLICADO: NOG-1"), /equipe/);
  assert.match(motivoAmigavel("erro estranho"), /equipe/);
});
