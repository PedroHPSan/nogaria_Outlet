// src/lib/empresa.js
// Dados de contato/marca da Nogária usados no anúncio/orçamento por item.
// Edite aqui para mudar o WhatsApp/nome que aparece no PDF e no QR.
export const EMPRESA = {
  nome: "Nogária Outlet",
  whatsapp: "5591992561815",       // só dígitos (país+DDD+número), formato do wa.me — número oficial desde 2026-11-02
  whatsappLabel: "+55 91 99256-1815",
  entrega: "Entrega grátis em Belém e Ananindeua. Outras cidades: a combinar, por transportadora.",
  tagline: "Logística Reversa & Outlet",
};

// Link wa.me com mensagem pré-preenchida (texto opcional).
export const waLink = (texto = "") =>
  `https://wa.me/${EMPRESA.whatsapp}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;

// Link de encaminhamento (sem número): o WhatsApp abre a lista de contatos
// para o operador escolher para quem enviar o texto pré-preenchido.
export const waLinkSemDestino = (texto = "") =>
  `https://wa.me/${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
