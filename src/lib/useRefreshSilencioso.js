// Recarga "silenciosa" disparada pelo realtime (refreshKey do App).
//
// O refreshKey muda a cada INSERT/UPDATE em `itens`, de qualquer usuário, inclusive em rajada
// durante uma ação em massa. Recarregar a lista "do zero" nesses momentos zerava seleção,
// categorias escolhidas e a rolagem de quem estava trabalhando na tela. Este hook:
// - ignora o valor inicial (a carga inicial é feita pelo efeito dos filtros);
// - agrupa a rajada de eventos (debounce);
// - não roda enquanto `pausado` (ex.: ação em andamento — ela mesma recarrega ao terminar).
import { useEffect, useRef } from "react";

export function useRefreshSilencioso(refreshKey, recarregar, { pausado = false, atrasoMs = 600 } = {}) {
  const inicial = useRef(refreshKey);
  const fn = useRef(recarregar);
  fn.current = recarregar;
  useEffect(() => {
    if (refreshKey === inicial.current || pausado) return;
    const t = setTimeout(() => fn.current(), atrasoMs);
    return () => clearTimeout(t);
  }, [refreshKey, pausado, atrasoMs]);
}
