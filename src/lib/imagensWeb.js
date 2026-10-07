// Busca de imagens na web (Google) para anexar ao item + helpers puros da query.
// A busca e o download passam pela Edge Function `buscar-imagens` (CORS + chave no servidor).
import { supabase } from "./supabase";

// Monta a query: produto + (marca) + (modelo) + termos extras, sem duplicar palavras
// já presentes (ex.: produto "Fritadeira Mondial" + marca "Mondial" não repete "Mondial").
export function montarQuery({ produto, marca, modelo, extra } = {}, { marca: usaMarca = true, modelo: usaModelo = true } = {}) {
  const partes = [produto, usaMarca ? marca : null, usaModelo ? modelo : null, extra]
    .map((p) => (p || "").trim())
    .filter(Boolean);
  const vistas = new Set();
  const out = [];
  for (const parte of partes) {
    for (const palavra of parte.split(/\s+/)) {
      const k = palavra.toLowerCase();
      if (!vistas.has(k)) { vistas.add(k); out.push(palavra); }
    }
  }
  return out.join(" ");
}

export const urlGoogleImagens = (q) => `https://www.google.com/search?tbm=isch&hl=pt-BR&gl=br&q=${encodeURIComponent(q)}`;

async function erroDaFuncao(error) {
  try {
    const j = await error.context?.json?.();
    return j?.error || error.message;
  } catch { return error.message; }
}

export async function buscarImagens(q, inicio = 1) {
  const { data, error } = await supabase.functions.invoke("buscar-imagens", { body: { acao: "buscar", q, inicio } });
  if (error) throw new Error(await erroDaFuncao(error));
  return data?.itens || [];
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

// Baixa a imagem pelo proxy e devolve um File pronto para enviarFoto().
export async function baixarImagem(url, nomeBase = "web") {
  const { data, error } = await supabase.functions.invoke("buscar-imagens", { body: { acao: "baixar", url } });
  if (error) throw new Error(await erroDaFuncao(error));
  if (!(data instanceof Blob)) throw new Error("resposta inesperada");
  const ext = EXT[data.type];
  if (!ext) throw new Error("formato não suportado");
  return new File([data], `${nomeBase}-${Date.now()}.${ext}`, { type: data.type || "image/jpeg" });
}
