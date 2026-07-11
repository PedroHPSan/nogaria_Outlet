// Núcleo PURO do preparo de imagens do catálogo (sem browser/rede): parâmetros de
// compressão e cálculo do tamanho-alvo. Importável em Node para teste; usado tanto
// pelo Web Worker quanto pelo fallback no main-thread.

// Lado maior máximo (px) da foto embutida no PDF e qualidade do JPEG. Equilíbrio
// nitidez × peso definido no spec (2026-07-10).
export const MAX_LADO = 1000;
export const JPEG_QUALITY = 0.72;

// Retorna { w, h } inteiros mantendo a proporção, com o lado maior limitado a
// maxLado. Nunca amplia (imagens menores que maxLado passam iguais).
export function dimensionarAlvo(w, h, maxLado = MAX_LADO) {
  const largura = Math.max(1, Math.round(w || 0));
  const altura = Math.max(1, Math.round(h || 0));
  const maior = Math.max(largura, altura);
  if (maior <= maxLado) return { w: largura, h: altura };
  const escala = maxLado / maior;
  return { w: Math.max(1, Math.round(largura * escala)), h: Math.max(1, Math.round(altura * escala)) };
}
