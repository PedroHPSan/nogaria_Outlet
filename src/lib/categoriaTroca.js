// Troca de categoria SEM deixar rastro da categoria errada (PURO, sem rede).
// Antes, trocar o grupo só mudava `grupo`: a `classe` (herdada da categoria errada, ex.: A+ de Smartphone)
// e o `preco_novo_est` legado (foto da âncora do grupo antigo, ex.: R$ 1.300) ficavam para trás e
// continuavam distorcendo classe, valor de referência e conferência.
import { classeAutomatica } from "./classificacao.js";

const num = (v) => (v == null || v === "" ? null : Number(v));
const CLASSES_POR_VALOR = new Set(["A+", "A", "B", "C"]); // D/E vêm de volume/condição: não mexer

/**
 * Patch a aplicar quando o item muda de `item.grupo` para `novoGrupo`.
 *  - `preco_novo_est`: se é igual à âncora do grupo ANTIGO, era só uma foto dela → limpa (preço digitado fica).
 *  - `classe`: se veio da categoria antiga (igual à classe típica do grupo antigo ou à automática dele),
 *    recalcula com o grupo novo; classe D/E ou definida à mão (diferente dessas) é preservada.
 */
export function aoTrocarCategoria(item, novoGrupo, params) {
  const patch = { grupo: novoGrupo || null };
  if (!item || !novoGrupo || novoGrupo === item.grupo) return patch;
  const antigo = params?.grupos?.[item.grupo];

  const est = num(item.preco_novo_est);
  const ancoraAntiga = num(antigo?.ancoraNovo);
  const limpouEst = est != null && ancoraAntiga != null && est === ancoraAntiga;
  if (limpouEst) patch.preco_novo_est = null;

  if (item.classe && CLASSES_POR_VALOR.has(item.classe)) {
    const daCategoriaAntiga = item.classe === antigo?.classe
      || item.classe === classeAutomatica(item, params).classe;
    if (daCategoriaAntiga) {
      const depois = { ...item, grupo: novoGrupo, ...(limpouEst ? { preco_novo_est: null } : {}) };
      patch.classe = classeAutomatica(depois, params).classe;
    }
  }
  return patch;
}
