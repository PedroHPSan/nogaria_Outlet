import { createClient } from "@supabase/supabase-js";

// import.meta.env é undefined em Node (testes puros) → optional chaining evita o throw.
const url = import.meta.env?.VITE_SUPABASE_URL;
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env");
}

export const supabase = url && key ? createClient(url, key) : null;
