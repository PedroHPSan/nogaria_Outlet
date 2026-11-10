// Páginas públicas (/p, /i, /c): rebusca preço/promoção de tempos em tempos e ao voltar para a aba, só com a aba visível.
// Anônimo não tem realtime (as tabelas são fechadas por RLS), então é uma consulta leve em intervalo.
import { useEffect, useRef } from "react";

export function useRevalidar(recarregar, ms = 60000, ativo = true) {
  const fn = useRef(recarregar);
  fn.current = recarregar;
  useEffect(() => {
    if (!ativo) return undefined;
    let ultima = Date.now();
    const rodar = () => { if (document.visibilityState === "visible") { ultima = Date.now(); fn.current(); } };
    const t = setInterval(rodar, ms);
    const vis = () => { if (Date.now() - ultima > 5000) rodar(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [ms, ativo]);
}
