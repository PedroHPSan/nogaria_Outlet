// Foto principal = foto de menor `ordem`. Marcar como principal dá à escolhida
// uma ordem abaixo do mínimo atual do SKU, então ela vira a capa em todos os
// consumidores (catálogo, portfólio, miniatura, anúncio) sem alterá-los.
import assert from "node:assert";
import { novaOrdemPrincipal } from "../src/lib/model.js";

// ordens contíguas → mínimo (0) - 1
assert.equal(novaOrdemPrincipal([{ ordem: 0 }, { ordem: 1 }, { ordem: 2 }]), -1);

// foto única
assert.equal(novaOrdemPrincipal([{ ordem: 0 }]), -1);

// ordens com buracos/negativas → menor (−2) - 1
assert.equal(novaOrdemPrincipal([{ ordem: -2 }, { ordem: 3 }]), -3);

// fora de ordem no array → ainda usa o menor valor
assert.equal(novaOrdemPrincipal([{ ordem: 5 }, { ordem: 2 }, { ordem: 8 }]), 1);

// lista vazia → 0 (sem fotos, base neutra)
assert.equal(novaOrdemPrincipal([]), 0);

// robustez: ordem ausente conta como 0
assert.equal(novaOrdemPrincipal([{}, { ordem: 4 }]), -1);

console.log("test_fotoprincipal OK");
