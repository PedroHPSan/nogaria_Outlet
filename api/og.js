// Preview (og:*) de /p/<slug> e /c/<slug>. O vercel.json direciona TODO acesso a essas
// rotas para cá (o robô do WhatsApp/desktop/web pode usar qualquer user-agent): o handler
// lê 1 linha via RPC anônima, pega o index.html do deploy e injeta as tags no <head>.
// Pessoas recebem a mesma SPA de sempre, com o preview embutido.
import { injetarOg, montarHtmlOg } from "../src/lib/ofertaCore.js";

export default async function handler(req, res) {
  const item = req.query.t === "i"; // /i/<sku>: SKU tem hífens (NOG-103-001)
  const slug = String(req.query.slug || "").replace(item ? /[^a-z0-9-]/gi : /[^a-z0-9]/gi, "").slice(0, 40);
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  const origem = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const prefixo = item ? "i" : req.query.t === "c" ? "c" : "p";
  let meta = { titulo: "Nogária Outlet", descricao: "Ofertas da Nogária Outlet." };
  try {
    if (slug && base && key) {
      const r = await fetch(`${base}/rest/v1/rpc/${item ? "item_publico" : "og_publico"}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(item ? { p_sku: slug.toUpperCase() } : { p_slug: slug }),
      });
      const raw = r.ok ? await r.json() : null;
      const d = item ? raw?.payload : raw; // item_publico devolve { payload, disponivel }
      if (d) {
        const og = d.og || {};
        meta = {
          titulo: og.titulo || d.titulo || meta.titulo,
          descricao: og.descricao || `Catálogo com ${d.total ?? "várias"} peças em oferta. Toque para ver e chamar no WhatsApp.`,
          imagem: og.imagem || null,
        };
      }
    }
  } catch { /* sem preview: cai no texto padrão */ }
  meta.url = `${origem}/${prefixo}/${slug}`;

  let html;
  try {
    const r = await fetch(`${origem}/index.html`);
    html = r.ok ? injetarOg(await r.text(), meta) : montarHtmlOg(meta);
  } catch { html = montarHtmlOg(meta); }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.status(200).send(html);
}
