// Elegibilidade ao catálogo (C1). Espelho de public.catalogo_elegibilidade (SQL): manter os dois iguais.
// Portão = Foto OK ou além. `reservado` só o banco sabe (item_disponivel); aqui vem em `ctx.reservado`.
export const STATUS_CATALOGO = ["FOTOGRAFADO", "PRECIFICADO", "PRONTO", "ANUNCIADO"];
const FINAIS = ["VENDIDO", "ENTREGUE", "DESCARTE"];

export const MOTIVO_ROTULO = {
  etapa: "Ainda não chegou em Foto OK", vendido: "Vendido ou fora do estoque", sem_foto: "Sem foto",
  sem_preco: "Sem preço", preco_nao_validado: "Preço aguardando validação", sem_estado: "Sem estado", sem_categoria: "Sem categoria", reservado: "Reservado",
};

export function elegibilidadeCatalogo(item, ctx = {}) {
  const motivos = [];
  if (FINAIS.includes(item.status)) motivos.push("vendido");
  else if (!STATUS_CATALOGO.includes(item.status)) motivos.push("etapa");
  if (!(ctx.fotos > 0)) motivos.push("sem_foto");
  if (!(Number(item.preco_ideal) > 0)) motivos.push("sem_preco");
  else if (item.preco_aprovacao !== "APROVADO") motivos.push("preco_nao_validado"); // preço é subjetivo: a Bárbara valida
  if (!item.estado) motivos.push("sem_estado");
  if (!String(item.grupo ?? "").trim()) motivos.push("sem_categoria");
  if (!FINAIS.includes(item.status) && ctx.reservado) motivos.push("reservado");
  return { elegivel: motivos.length === 0, motivos };
}
