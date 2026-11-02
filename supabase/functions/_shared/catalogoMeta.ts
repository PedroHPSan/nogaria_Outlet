// Feed CSV do catálogo Meta (Commerce Manager) a partir do snapshot publicado + disponibilidade ao vivo.
// Colunas obrigatórias da Meta: id, title, description, availability, condition, price, link, image_link, brand.

type ItemPayload = {
  sku: string; produto?: string; marca?: string; cor?: string; medidas?: string; condicao?: string;
  badge?: { cls?: string } | null; preco?: number | null; foto?: string | null;
  rotulos?: { grupo?: string | null; lote?: string | number | null; tamanho?: string | null; estado?: string | null } | null;
};
export type LinhaFeed = { sku: string; payload: { itens?: ItemPayload[] } | null; disponivel: boolean };

export const COLUNAS = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand", "color",
  "product_type", "custom_label_0", "custom_label_1", "custom_label_2", "size"] as const;

// Proteção contra injeção de fórmula em planilhas (=, +, -, @) e normalização de quebras.
const limpa = (s: unknown) => {
  const t = String(s ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return /^[=+\-@]/.test(t) ? `'${t}` : t;
};
const csv = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Faixas de preço para conjuntos de anúncio ("até R$ 150"). Rótulo estável e legível no Commerce Manager.
export const FAIXAS_PRECO: [number, string][] = [[50, "ate-50"], [100, "51-100"], [150, "101-150"], [250, "151-250"], [500, "251-500"], [Infinity, "acima-500"]];
export const faixaPreco = (preco: number): string => FAIXAS_PRECO.find(([max]) => preco <= max)![1];

export function condicaoMeta(it: ItemPayload): "new" | "used" {
  return it.badge?.cls === "novo" ? "new" : "used";
}

export function linhaCsv(l: LinhaFeed, site: string): string[] | null {
  const it = l.payload?.itens?.[0];
  if (!it || !it.foto || !(Number(it.preco) > 0)) return null; // sem foto/preço a Meta rejeita o item
  const desc = [it.condicao, it.medidas, it.cor].map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ") || it.produto || it.sku;
  return [
    limpa(l.sku), limpa((it.produto || it.sku).slice(0, 150)), limpa(desc.slice(0, 500)),
    l.disponivel ? "in stock" : "out of stock", condicaoMeta(it),
    `${Number(it.preco).toFixed(2)} BRL`, `${site.replace(/\/+$/, "")}/i/${encodeURIComponent(l.sku)}`,
    it.foto, limpa(it.marca || "Nogária Outlet"), limpa(it.cor || ""),
    limpa(it.rotulos?.grupo || ""), it.rotulos?.lote != null && it.rotulos.lote !== "" ? limpa(`lote-${it.rotulos.lote}`) : "",
    faixaPreco(Number(it.preco)), limpa(it.rotulos?.estado || ""), limpa(it.rotulos?.tamanho || ""),
  ];
}

export function montarFeed(linhas: LinhaFeed[], site: string): { csv: string; total: number; ignorados: string[] } {
  const out = [COLUNAS.join(",")]; const ignorados: string[] = [];
  for (const l of linhas) {
    const c = linhaCsv(l, site);
    if (c) out.push(c.map(csv).join(",")); else ignorados.push(l.sku);
  }
  return { csv: out.join("\n") + "\n", total: out.length - 1, ignorados };
}
