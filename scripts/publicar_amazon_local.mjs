// publicar_amazon_local.mjs — chama a Edge `publicar-amazon` servida localmente em
// DRY-RUN, para inspecionar o payload sem tocar a Amazon nem produção.
//
// Pré-requisitos (terminal separado):
//   printf "AMZ_DRY_RUN=1\n" > supabase/.env.local
//   supabase start
//   supabase functions serve publicar-amazon --no-verify-jwt --env-file supabase/.env.local
//   # seed: insira no banco LOCAL um item com preco_ideal + GTIN(13) e um usuário (auth).
//
// Uso: node scripts/publicar_amazon_local.mjs <SKU> [<JWT de usuário local>]
//   FN_URL e LOCAL_ANON_KEY podem sobrescrever os defaults locais do supabase.
const sku = process.argv[2];
if (!sku) { console.error("uso: node scripts/publicar_amazon_local.mjs <SKU> [jwt]"); process.exit(1); }
const jwt = process.argv[3] || process.env.LOCAL_USER_JWT || process.env.LOCAL_ANON_KEY || "";
const FN_URL = process.env.FN_URL || "http://127.0.0.1:54321/functions/v1/publicar-amazon";
const KEY = process.env.LOCAL_ANON_KEY || jwt;

const r = await fetch(FN_URL, {
  method: "POST",
  headers: { Authorization: `Bearer ${jwt}`, apikey: KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ sku }),
});
console.log("status", r.status);
console.log(JSON.stringify(await r.json().catch(() => ({})), null, 2));
