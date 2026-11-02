// Registro de handlers do worker por `tipo` de job. Cada handler recebe o payload e lança em caso de
// falha (o worker aplica backoff). Novos canais registram aqui (ex.: "amazon.quantidade" no E3-2).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { processarWhatsapp } from "./whatsapp.ts";
import { enviarTemplate } from "./waTemplate.ts";
import { retirarCatalogo, amazonQuantidade } from "./retirada.ts";
import { comentarVendido, publicarInstagram, renovarTokenInstagram } from "./instagram.ts";

export type Ctx = { dryRun: boolean; admin: SupabaseClient; job: { id: number; tentativas: number } };
export type Handler = (payload: Record<string, unknown>, ctx: Ctx) => Promise<void>;

// Enquanto o processamento real de cada canal não existe (E1-2, E4-2), só marca o evento da inbox como visto.
const marcarProcessado: Handler = async (payload, { admin }) => {
  const { error } = await admin.from("webhook_eventos").update({ processado_em: new Date().toISOString() })
    .eq("canal", String(payload.canal)).eq("external_id", String(payload.external_id));
  if (error) throw new Error(error.message);
};

export const handlers: Record<string, Handler> = {
  "processar.mercadolivre": marcarProcessado,
  "processar.whatsapp": processarWhatsapp,
  "wa.template": enviarTemplate,
  "ig.publicar": publicarInstagram,
  "ig.comentar_vendido": comentarVendido,
  "catalogo.retirar": retirarCatalogo,
  "amazon.quantidade": amazonQuantidade,
  "ig.refresh_token": renovarTokenInstagram,
  "processar.instagram": marcarProcessado,
  // Usado em testes locais e para validar o ciclo cron → worker.
  noop: async (payload) => {
    if (payload.falhar) throw new Error(String(payload.falhar));
  },
};
