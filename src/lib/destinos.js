// Destinos logísticos e locais de storage cadastráveis (tabelas `destinos` e `locais_storage`).
// `DESTINOS` (model.js) é uma lista VIVA: carregarDestinos() a atualiza no lugar, então telas e
// colunas que já importam DESTINOS passam a refletir o cadastro. Se as tabelas ainda não existem
// (migration não aplicada) ou a rede falha, a lista fixa original continua valendo.
import { supabase } from "./supabase.js";
import { DESTINOS, DESTINOS_PADRAO } from "./model.js";
import { COLUNAS_PLANILHA } from "./planilha.js";

let cadastro = DESTINOS_PADRAO.map((nome, i) => ({ nome, internacional: false, ativo: true, ordem: (i + 1) * 10 }));
let locais = [];

export const destinosCadastrados = () => cadastro;
export const locaisDoDestino = (destino) => locais.filter((l) => l.ativo && (!destino || l.destino === destino)).map((l) => l.nome);
export const ehInternacional = (destino) => !!cadastro.find((d) => d.nome === destino)?.internacional;

function aplicar(linhas) {
  const ativos = linhas.filter((d) => d.ativo).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
  cadastro = linhas;
  if (!ativos.length) return;
  DESTINOS.splice(0, DESTINOS.length, ...ativos.map((d) => d.nome));
  const col = COLUNAS_PLANILHA.find((c) => c.key === "destino"); // opções da planilha eram copiadas no carregamento
  if (col) col.opcoes = DESTINOS.map((v) => ({ v, label: v }));
}

// Retorna true se leu do banco; false se ficou com a lista padrão.
export async function carregarDestinos() {
  try {
    const [d, l] = await Promise.all([
      supabase.from("destinos").select("*").order("ordem").order("nome"),
      supabase.from("locais_storage").select("*").order("nome"),
    ]);
    if (d.error || !d.data?.length) return false;
    aplicar(d.data);
    locais = l.error ? [] : l.data || [];
    return true;
  } catch { return false; }
}

const limpar = (s) => String(s ?? "").trim().replace(/\s+/g, " ");

export async function criarDestino({ nome, internacional = false, pais = "" }) {
  const n = limpar(nome);
  if (!n) throw new Error("Informe o nome do destino.");
  if (cadastro.some((d) => d.nome.toLowerCase() === n.toLowerCase())) throw new Error("Já existe um destino com esse nome.");
  const ordem = Math.max(0, ...cadastro.filter((d) => d.nome !== "A definir").map((d) => d.ordem)) + 10;
  const { error } = await supabase.from("destinos").insert({ nome: n, internacional, pais: limpar(pais) || null, ordem: Math.min(ordem, 80) });
  if (error) throw error;
  await carregarDestinos();
}

export async function atualizarDestino(id, campos) {
  const { error } = await supabase.from("destinos").update(campos).eq("id", id);
  if (error) throw error;
  await carregarDestinos();
}

export async function criarLocal(destino, nome) {
  const n = limpar(nome);
  if (!n) throw new Error("Informe o nome do local.");
  const { error } = await supabase.from("locais_storage").insert({ destino, nome: n });
  if (error) throw new Error(error.code === "23505" ? "Esse local já existe neste destino." : error.message);
  await carregarDestinos();
}

export async function atualizarLocal(id, campos) {
  const { error } = await supabase.from("locais_storage").update(campos).eq("id", id);
  if (error) throw error;
  await carregarDestinos();
}

// Itens por destino (para acompanhar o estoque que vai para a base internacional).
export async function contarItensPorDestino(nomes) {
  const out = {};
  await Promise.all(nomes.map(async (n) => {
    const { count } = await supabase.from("itens").select("sku", { count: "exact", head: true }).eq("destino", n);
    out[n] = count ?? 0;
  }));
  return out;
}
