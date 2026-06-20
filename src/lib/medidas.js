// Rastreabilidade de medição (dimensões & peso). Nem todo item é medido/pesado
// na triagem: o sistema segue com valores ESTIMADOS (média da categoria ou IA) e
// registra a origem em `itens.medidas_fonte` para re-medir depois o que ficou
// pendente. Lógica de dados isolada dos componentes (padrão de lib/conferencia.js).
import { supabase } from "./supabase";

export const MEDIDAS_FONTE = { MEDIDO: "MEDIDO", ESTIMADO: "ESTIMADO", A_MEDIR: "A_MEDIR" };

// Item pendente de medição = qualquer coisa que não seja MEDIDO (inclui null,
// itens só pré-carregados da planilha-mãe). É o critério do filtro/export/contadores.
export const pendenteMedida = (it) => (it?.medidas_fonte || null) !== MEDIDAS_FONTE.MEDIDO;

// Badge legível da origem da medida (rótulo + classes Tailwind p/ cor).
export function fonteLabel(it) {
  switch (it?.medidas_fonte) {
    case MEDIDAS_FONTE.MEDIDO:
      return { texto: "Medido ✓", cls: "bg-emerald-100 text-emerald-700" };
    case MEDIDAS_FONTE.ESTIMADO:
      return { texto: "Estimado", cls: "bg-amber-100 text-amber-700" };
    case MEDIDAS_FONTE.A_MEDIR:
      return { texto: "A medir", cls: "bg-gray-200 text-gray-600" };
    default:
      return { texto: "Não medido", cls: "bg-gray-200 text-gray-600" };
  }
}

const mediana = (nums) => {
  const v = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const _cache = new Map(); // grupo -> { comprimento_cm, largura_cm, altura_cm, peso_kg } | null

// Estima medidas pela MEDIANA dos itens da mesma categoria (grupo) que já têm
// valor (medido ou pré-carregado). Sem chamada de IA/API. Cacheia por grupo.
// Retorna null se não houver amostra suficiente. Cada campo é estimado de forma
// independente (tolera dados parciais).
export async function estimarPorCategoria(grupo) {
  const g = (grupo || "").trim();
  if (!g) return null;
  if (_cache.has(g)) return _cache.get(g);

  const { data, error } = await supabase
    .from("itens")
    .select("comprimento_cm, largura_cm, altura_cm, peso_real_kg, peso_kg")
    .eq("grupo", g)
    .limit(500);
  if (error || !data?.length) {
    _cache.set(g, null);
    return null;
  }

  const comp = mediana(data.map((r) => Number(r.comprimento_cm)));
  const larg = mediana(data.map((r) => Number(r.largura_cm)));
  const alt = mediana(data.map((r) => Number(r.altura_cm)));
  const peso = mediana(data.map((r) => Number(r.peso_real_kg ?? r.peso_kg)));
  const r1 = (n) => (n == null ? null : Math.round(n));
  const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const est = { comprimento_cm: r1(comp), largura_cm: r1(larg), altura_cm: r1(alt), peso_kg: r2(peso) };

  const vazio = [est.comprimento_cm, est.largura_cm, est.altura_cm, est.peso_kg].every((v) => v == null);
  const out = vazio ? null : est;
  _cache.set(g, out);
  return out;
}

export const limparCacheMedidas = () => _cache.clear();

// Registra no histórico (eventos) a origem da medição do item — best-effort,
// igual a registrarSemTeste. acao: "medidas:medido" | ":estimado" | ":a_medir".
export async function registrarMedida(sku, fonte, detalhe, user) {
  if (!fonte) return;
  await supabase.from("eventos").insert({
    sku,
    acao: "medidas:" + String(fonte).toLowerCase(),
    detalhe: detalhe || null,
    usuario: user?.email,
  });
}
