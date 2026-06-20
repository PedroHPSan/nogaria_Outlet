// Edge Function: enriquecer-produto
// Camada de IA pós-triagem: completa os dados exigidos para anúncio (título, descrição,
// categoria, marca/modelo, NCM, voltagem, cor, dimensões), sugere um PREÇO DE REFERÊNCIA
// de mercado e emite um diagnóstico do cadastro. NÃO grava no banco — devolve sugestões;
// quem aplica (campo a campo) é o front (src/screens/ItemDetail.jsx).
//
// Entradas: { produto, marca?, modelo?, grupo?, gtin?, ncm?, estado?, voltagem?,
//             dimensoes?, categorias?: string[], fotos_urls?: string[] }
//   - categorias: lista de categorias válidas (chaves de pricing_grupo) p/ a IA escolher.
//   - fotos_urls: URLs assinadas do bucket fotos-produtos. Só são enviadas quando o
//     usuário pede "analisar com foto" (texto-primeiro p/ controlar custo).
//
// Saída: { titulo_anuncio, descricao_anuncio, marca, modelo, grupo, ncm, voltagem, cor,
//          dimensoes_estimadas, preco_ref_novo, preco_ref_usado, preco_ref_confianca,
//          preco_ref_fonte, campos_faltantes[], observacoes, usou_foto }
//   Os nomes preco_ref_* batem com as colunas da tabela itens, então o PricingCard
//   consome a sugestão sem mudança.
//
// Secrets (supabase secrets set ...):
//   ANTHROPIC_API_KEY  — chave da Claude API (NUNCA logar)
//   ANTHROPIC_MODEL    — opcional; default claude-sonnet-4-6 (trocar p/ opus/haiku sem deploy)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6";

// Schema de saída estruturada (structured outputs). Sem minLength/maximum (não suportado);
// faixas são validadas no front se necessário.
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    titulo_anuncio: { type: "string", description: "Título de anúncio (até ~60 caracteres), marca + modelo + característica-chave." },
    descricao_anuncio: { type: "string", description: "Descrição comercial curta (2-4 frases), honesta quanto ao estado/condição." },
    marca: { type: ["string", "null"] },
    modelo: { type: ["string", "null"] },
    grupo: { type: ["string", "null"], description: "Categoria EXATAMENTE como uma das fornecidas em `categorias`; null se nenhuma servir." },
    ncm: { type: ["string", "null"], description: "Código NCM de 8 dígitos, sem pontuação; null se incerto." },
    voltagem: { type: ["string", "null"], enum: ["110V", "220V", "Bivolt", "N/A", null] },
    cor: { type: ["string", "null"] },
    dimensoes_estimadas: {
      type: "object",
      additionalProperties: false,
      properties: {
        comprimento_cm: { type: ["number", "null"] },
        largura_cm: { type: ["number", "null"] },
        altura_cm: { type: ["number", "null"] },
        peso_kg: { type: ["number", "null"] },
      },
      required: ["comprimento_cm", "largura_cm", "altura_cm", "peso_kg"],
    },
    preco_ref_novo: { type: ["number", "null"], description: "Preço de mercado BR estimado para o item NOVO (R$)." },
    preco_ref_usado: { type: ["number", "null"], description: "Preço de mercado BR estimado para o item USADO em bom estado (R$)." },
    preco_ref_confianca: { type: "string", enum: ["ALTA", "MEDIA", "BAIXA"] },
    campos_faltantes: { type: "array", items: { type: "string" }, description: "Campos importantes ainda vazios/duvidosos para um bom anúncio." },
    observacoes: { type: "string", description: "Diagnóstico curto: o que melhorar no cadastro antes de anunciar." },
  },
  required: [
    "titulo_anuncio", "descricao_anuncio", "marca", "modelo", "grupo", "ncm", "voltagem", "cor",
    "dimensoes_estimadas", "preco_ref_novo", "preco_ref_usado", "preco_ref_confianca",
    "campos_faltantes", "observacoes",
  ],
};

const SYSTEM = [
  "Você assiste uma operação de revenda de logística reversa no Brasil (NOGÁRIA OUTLET).",
  "A partir dos dados de um produto, complete o cadastro para anúncio em marketplaces (Mercado Livre, Amazon e outros) e estime preços de referência.",
  "Regras:",
  "- Preços são ESTIMATIVAS de mercado brasileiro em reais (R$), não cotações reais. Seja realista e conservador.",
  "- 'grupo' (categoria) deve ser EXATAMENTE uma das opções fornecidas pela mensagem do usuário; se nenhuma servir bem, retorne null (não invente categoria).",
  "- NCM só quando tiver razoável certeza (8 dígitos, sem pontuação); senão null.",
  "- Não invente marca/modelo/série que não dê para inferir; use null.",
  "- Título e descrição honestos quanto à condição informada (Novo, Usado, Avariado, etc.).",
  "- Responda SEMPRE no formato estruturado pedido.",
].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // valida o chamador (JWT de usuário autenticado do app)
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: "não autenticado" }, 401);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY não configurada" }, 500);

    const body = await req.json();
    const {
      produto, marca, modelo, grupo, gtin, ncm, estado, voltagem, dimensoes,
      categorias, fotos_urls,
    } = body ?? {};
    if (!produto && !gtin) return json({ error: "informe ao menos 'produto'" }, 400);

    // Contexto do item (texto-primeiro).
    const dados = {
      produto, marca, modelo, grupo, gtin, ncm, estado, voltagem, dimensoes,
    };
    const linhas = [
      "Dados atuais do produto (campos vazios = preencher):",
      "```json",
      JSON.stringify(dados, null, 2),
      "```",
      "",
      "Categorias válidas para 'grupo' (escolha uma exatamente, ou null):",
      Array.isArray(categorias) && categorias.length ? categorias.join(" | ") : "(nenhuma fornecida — pode retornar null)",
    ];

    // Conteúdo da mensagem do usuário: texto + (opcional) fotos.
    const fotos = Array.isArray(fotos_urls) ? fotos_urls.filter((x) => typeof x === "string" && x).slice(0, 4) : [];
    const usouFoto = fotos.length > 0;
    const userContent: any[] = [{ type: "text", text: linhas.join("\n") }];
    for (const url of fotos) {
      userContent.push({ type: "image", source: { type: "url", url } });
    }

    const payload = {
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      // prompt caching: o system (estável) é cacheado; reduz custo em chamadas repetidas.
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content: userContent }],
    };

    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      // não vaza a chave; só status + corpo de erro da API.
      console.warn(`[enriquecer-produto] Claude HTTP ${r.status} :: ${t.slice(0, 300)}`);
      return json({ error: `Claude API HTTP ${r.status}`, detalhe: t.slice(0, 500) }, 502);
    }
    const msg = await r.json();
    if (msg.stop_reason === "refusal") {
      return json({ error: "a IA recusou a solicitação", stop_reason: "refusal" }, 422);
    }
    // structured outputs: o texto vem como JSON no bloco de texto.
    const textBlock = (msg.content ?? []).find((b: any) => b.type === "text");
    if (!textBlock?.text) return json({ error: "resposta da IA sem conteúdo" }, 502);
    let out: any;
    try {
      out = JSON.parse(textBlock.text);
    } catch {
      return json({ error: "resposta da IA não é JSON válido", bruto: textBlock.text.slice(0, 500) }, 502);
    }

    // Garante a categoria dentro da lista; se vier algo fora, descarta (não polui o pricing_grupo).
    if (out.grupo && Array.isArray(categorias) && categorias.length && !categorias.includes(out.grupo)) {
      out.grupo = null;
    }
    out.preco_ref_fonte = "IA:claude";
    out.usou_foto = usouFoto;
    out.modelo_ia = MODEL;
    return json(out);
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
