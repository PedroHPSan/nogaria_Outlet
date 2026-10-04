// Contato configurável da Nogária (PURO): converte as chaves de empresa_config no
// bloco `contato` da spec do catálogo. Sem rede.
import { EMPRESA } from "./empresa.js";

export const CHAVES_CONTATO = [
  { chave: "whatsapp", rotulo: "WhatsApp (DDI+DDD+número)", placeholder: "5591983929085" },
  { chave: "instagram", rotulo: "Instagram", placeholder: "@nogaria" },
  { chave: "site", rotulo: "Site", placeholder: "www.nogaria.com.br" },
  { chave: "email", rotulo: "E-mail", placeholder: "contato@…" },
  { chave: "telefone", rotulo: "Telefone", placeholder: "(91) 3000-0000" },
  { chave: "endereco", rotulo: "Endereço / retirada", placeholder: "Belém — PA" },
  { chave: "horario", rotulo: "Horário", placeholder: "Seg–Sáb, 9h–18h" },
];

// 5591983929085 → "+55 91 98392-9085" (celular BR); fora do padrão, devolve "+dígitos".
export function rotuloWhatsApp(digitos) {
  const d = String(digitos || "").replace(/\D/g, "");
  const m = d.match(/^(55)(\d{2})(9?\d{4})(\d{4})$/);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : d ? `+${d}` : "";
}

const EXTRAS = [["instagram", "Instagram"], ["site", "Site"], ["email", "E-mail"], ["telefone", "Telefone"], ["endereco", "Endereço"], ["horario", "Horário"]];

// cfg: { chave: valor } (vazio/ausente → EMPRESA). Retorna { whatsapp, whatsappLabel, extras }.
export function configParaContato(cfg = {}) {
  const wa = String(cfg.whatsapp || "").replace(/\D/g, "");
  const ok = wa.length >= 12;
  return {
    whatsapp: ok ? wa : EMPRESA.whatsapp,
    whatsappLabel: ok ? rotuloWhatsApp(wa) : EMPRESA.whatsappLabel,
    extras: EXTRAS.filter(([k]) => String(cfg[k] || "").trim()).map(([k, rotulo]) => ({ rotulo, valor: String(cfg[k]).trim() })).slice(0, 6),
  };
}
