// N2 (#85): o app só muda status de item por RPC (mover_etapa / baixar_venda / marcar_entregue / reabrir_estoque).
// Teste estático: falha se algum arquivo de src/ grava `status` direto em `itens`. Rode: npm run test:statusrpc
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const arquivos = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? arquivos(p) : /\.(js|jsx)$/.test(n) ? [p] : [];
});
const src = arquivos("src").map((p) => [p, readFileSync(p, "utf8")]);
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ok  ${m}`); };

console.log("nenhum update de itens grava status");
const PADROES = [
  [/status:\s*(novoStatus|"(VENDIDO|ENTREGUE|DESCARTE)")/, "status: novoStatus / literal final em objeto"],
  [/\b(patch|corpo|prop|patchItens)\.status\s*=/, "atribuição patch.status ="],
  [/\.\.\.\(novoStatus \? \{ status/, "spread condicional de status"],
  [/from\("itens"\)\s*\.update\(\{[^}]*\bstatus\b/s, "update inline com status"],
];
const PERMITIDO = [/atualizado = fresco \|\| \{ \.\.\.data, status: novoStatus \}/]; // fallback de estado local (não grava no banco)
for (const [rotulo, re] of PADROES.map(([r, t]) => [t, r])) {
  const achados = [];
  for (const [p, txt] of src) {
    for (const linha of txt.split("\n")) {
      if (re.test(linha) && !PERMITIDO.some((x) => x.test(linha))) achados.push(`${p}: ${linha.trim().slice(0, 100)}`);
    }
    if (re.flags.includes("s") && re.test(txt)) achados.push(`${p}: (multilinha)`);
  }
  ok(achados.length === 0, `sem "${rotulo}"${achados.length ? " — " + achados.join(" | ") : ""}`);
}

console.log("os pontos de transição usam as RPCs");
const lib = Object.fromEntries(src);
ok(/rpc\("mover_etapa"/.test(lib["src/lib/conferencia.js"]), "moverEtapa → RPC mover_etapa");
ok(/rpc\("reabrir_estoque"/.test(lib["src/lib/conferencia.js"]), "reabrirEstoque → RPC reabrir_estoque");
ok(/rpc\("marcar_entregue"/.test(lib["src/lib/vendas.js"]), "marcarEntregue → RPC marcar_entregue");
ok(/rpc\("baixar_venda"/.test(lib["src/lib/vendas.js"]), "registrarVenda → RPC baixar_venda");
ok(/registrarVenda\(it\.sku/.test(lib["src/screens/ItemDetail.jsx"]), "ficha vende por registrarVenda");
ok(/moverEtapa\(it\.sku, destino/.test(lib["src/screens/ConferenciaScreen.jsx"]) || /moverEtapa\(/.test(lib["src/screens/ConferenciaScreen.jsx"]), "mover em massa usa moverEtapa");
ok(/moverEtapa\(it\.sku, patch\.status/.test(lib["src/screens/PlanilhaScreen.jsx"]), "planilha muda status por moverEtapa");
ok(/foraDoEstoque\(item\.status\)/.test(lib["src/lib/conferencia.js"]), "desmembrar não copia status final");
console.log(`\n${n} asserções OK`);
