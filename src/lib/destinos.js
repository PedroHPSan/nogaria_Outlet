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
// Nomes dos destinos ativos marcados como internacionais (vazio → filtro não encontra nada, por segurança).
export const destinosInternacionais = () => cadastro.filter((d) => d.ativo && d.internacional).map((d) => d.nome);
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

// Renomeia o destino e acompanha itens, caixas e locais que usavam o nome antigo.
export async function renomearDestino(id, novoNome) {
  const atual = cadastro.find((d) => d.id === id);
  const n = limpar(novoNome);
  if (!atual) throw new Error("Destino não encontrado.");
  if (!n) throw new Error("Informe o nome.");
  if (n === atual.nome) return;
  if (atual.nome === "A definir") throw new Error('"A definir" é o destino padrão e não pode ser renomeado.');
  if (cadastro.some((d) => d.id !== id && d.nome.toLowerCase() === n.toLowerCase())) throw new Error("Já existe um destino com esse nome.");
  const { error } = await supabase.from("destinos").update({ nome: n }).eq("id", id);
  if (error) throw error;
  for (const [tabela, coluna] of [["itens", "destino"], ["caixas", "destino"], ["locais_storage", "destino"]]) {
    const r = await supabase.from(tabela).update({ [coluna]: n }).eq(coluna, atual.nome);
    if (r.error) throw new Error(`Destino renomeado, mas falhou ao atualizar ${tabela}: ${r.error.message}. Renomeie de volta ou repita a operação.`);
  }
  await carregarDestinos();
}

// Troca a posição com o vizinho (sobe/desce na lista de escolha).
export async function moverDestino(id, direcao) {
  const ord = [...cadastro].sort((a, b) => a.ordem - b.ordem);
  const i = ord.findIndex((d) => d.id === id);
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= ord.length) return;
  const [a, b] = [ord[i], ord[j]];
  const [r1, r2] = await Promise.all([
    supabase.from("destinos").update({ ordem: b.ordem }).eq("id", a.id),
    supabase.from("destinos").update({ ordem: a.ordem }).eq("id", b.id),
  ]);
  if (r1.error || r2.error) throw r1.error || r2.error;
  await carregarDestinos();
}
