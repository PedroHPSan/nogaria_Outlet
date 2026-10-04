// Compartilhamento de arquivos/texto no celular (Web Share) com fallback.
// Web Share com arquivos: iOS Safari 15+ e Android Chrome. Desktop → download.
export const podeCompartilharArquivo = (file) =>
  typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [file] });

export function baixarArquivo(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Retorna "compartilhado" | "baixado" | "cancelado".
export async function compartilharArquivo(blob, nome, { titulo, texto } = {}) {
  const file = new File([blob], nome, { type: blob.type || "application/pdf" });
  if (podeCompartilharArquivo(file)) {
    try {
      await navigator.share({ files: [file], title: titulo, text: texto });
      return "compartilhado";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelado";
    }
  }
  baixarArquivo(blob, nome);
  return "baixado";
}

export async function compartilharTexto(texto, titulo) {
  if (typeof navigator !== "undefined" && navigator.share) {
    try { await navigator.share({ title: titulo, text: texto }); return "compartilhado"; }
    catch (e) { if (e?.name === "AbortError") return "cancelado"; }
  }
  await navigator.clipboard?.writeText(texto);
  return "copiado";
}
