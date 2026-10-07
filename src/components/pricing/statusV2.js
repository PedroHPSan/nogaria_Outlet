// Rótulos e cores do status que o motor de preço v2 devolve (compartilhado pela tela do item,
// pela revisão em massa e pelo rateio do lote).
export const STATUS_V2 = {
  ANUNCIAR: { txt: "Pode anunciar", cls: "bg-emerald-600 text-white" },
  GIRO: { txt: "Margem abaixo de 25%", cls: "bg-amber-500 text-white" },
  LOCAL: { txt: "Só fecha em venda local", cls: "bg-amber-500 text-white" },
  KIT: { txt: "Agrupar em kit", cls: "bg-blue-600 text-white" },
  SEM_REF: { txt: "Sem referência", cls: "bg-gray-500 text-white" },
  INVIAVEL: { txt: "Abaixo do piso", cls: "bg-red-500 text-white" },
};
