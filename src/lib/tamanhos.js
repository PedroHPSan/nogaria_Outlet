// A regra de tamanhos vive em supabase/functions/_shared/tamanhos.js para ser a mesma no
// front e no feed do catálogo da Meta (Edge Function). Este arquivo só reexporta.
export * from "../../supabase/functions/_shared/tamanhos.js";
