// src/lib/empresa.js
// Dados de contato/marca da Nogária usados no anúncio/orçamento por item.
// Edite aqui para mudar o WhatsApp/nome que aparece no PDF e no QR.
export const EMPRESA = {
  nome: "Nogária Outlet",
  whatsapp: "5591983929085",       // só dígitos (país+DDD+número), formato do wa.me
  whatsappLabel: "+55 91 98392-9085",
  tagline: "Logística Reversa & Outlet",
};

// Link wa.me com mensagem pré-preenchida (texto opcional).
export const waLink = (texto = "") =>
  `https://wa.me/${EMPRESA.whatsapp}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
