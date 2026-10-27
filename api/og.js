// Preview (og:*) para robôs de link (WhatsApp, Telegram…): o vercel.json só direciona
// para cá requisições com user-agent de robô em /p/<slug> e /c/<slug>. Pessoas
// recebem a SPA normalmente. Lê 1 linha via RPC anônima e devolve HTML mínimo.
import { montarHtmlOg } from "../src/lib/ofertaCore.js";

export default async function handler(req, res) {
  const slug = String(req.query.slug || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  const origem = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const prefixo = req.query.t === "c" ? "c" : "p";
  let meta = { titulo: "Nogária Outlet", descricao: "Ofertas da Nogária Outlet." };
  try {
    if (slug && base && key) {
      const r = await fetch(`${base}/rest/v1/rpc/og_publico`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_slug: slug }),
      });
      const d = r.ok ? await r.json() : null;
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
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.status(200).send(montarHtmlOg({ ...meta, url: `${origem}/${prefixo}/${slug}` }));
}
