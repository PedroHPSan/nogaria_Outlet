// Preferência de layout: "desktop" (menu lateral e telas largas em PC) ou "mobile" (coluna única, como no celular).
// A classe `layout-mobile` no <html> desliga as variantes `desk:` do Tailwind (ver tailwind.config.js); o script
// inline do index.html aplica a classe antes do React carregar, para não piscar.
import { useCallback, useState } from "react";

const CHAVE = "layout";
const ler = () => { try { return localStorage.getItem(CHAVE) === "mobile" ? "mobile" : "desktop"; } catch { return "desktop"; } };
const aplicar = (modo) => document.documentElement.classList.toggle("layout-mobile", modo === "mobile");

export function useLayoutPref() {
  const [modo, setModo] = useState(ler);
  const alternar = useCallback(() => {
    const novo = ler() === "mobile" ? "desktop" : "mobile";
    try { localStorage.setItem(CHAVE, novo); } catch { /* sem storage: vale só nesta sessão */ }
    aplicar(novo);
    setModo(novo);
  }, []);
  return [modo, alternar];
}
