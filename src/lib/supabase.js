import { createClient } from "@supabase/supabase-js";

// import.meta.env só existe sob o Vite; em Node (testes) cai para {} e usa um
// placeholder — o cliente não é usado nos testes de função pura, só não pode
// estourar no momento do import.
const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env");
}

export const supabase = createClient(url || "http://localhost:54321", key || "public-anon-key");
