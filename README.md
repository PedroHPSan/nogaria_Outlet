# NOGÁRIA OUTLET — Catálogo & Checklist

App de catalogação e checklist da operação de logística reversa NOGÁRIA OUTLET.
Frontend Vite + React + Tailwind, banco e autenticação no Supabase.

## Funcionalidades
- Catálogo dos itens arrematados (importados da planilha-mãe).
- Checklist de condição por item com **máquina de estados**:
  `A catalogar → Triado → Testado → Fotografado → Precificado → Pronto → Anunciado → Vendido` (+ Descarte).
- Fotos por item via câmera do celular (Supabase Storage).
- Painel com progresso por status, classe (A+…E) e lote.
- Registro de auditoria em tempo real (quem mudou o quê).
- Login restrito (Pedro e Bárbara) e sincronização em tempo real entre os dois.
- **Impressão de etiquetas térmicas (Brother QL-800)** — etiquetas de Produto,
  Quarentena/Avaria, Caixa e Mala, com QR (SKU/caixa) para conferência. Imprime pelo
  diálogo do navegador (driver Brother corta entre as etiquetas) ou baixa em PDF.

> **Busca de preço no Mercado Livre — desativada temporariamente.** O Mercado Livre
> desativou a pesquisa de preços, então o botão "Buscar preço ML" foi retirado da
> precificação. A referência de preço passa a usar a âncora do grupo (ou o valor já
> salvo no item). A Edge Function `precos-mercado`, a função `ml-notifications` e a
> migration `ml_oauth` foram **preservadas** no repositório para serem religadas quando
> a pesquisa de preços do ML voltar. O Mercado Livre continua disponível como canal de venda.

## Etiquetas (Brother QL-800)
- **Um item:** abra o item → botão **Etiqueta** (topo) → escolha o rolo → *Imprimir* ou *Baixar PDF*.
- **Em massa:** na aba **Itens**, toque em **Etiquetas** para entrar no modo de seleção,
  marque os itens (ou *Todos*) e toque em **Imprimir N etiqueta(s)**.
- **Caixa/Mala:** na aba **Itens**, botão **Caixa/Mala** → escolha o `caixa_num`
  (ex.: `CX-SP-001`, `MALA-BAR-01`); a etiqueta externa lista os SKUs e o valor estimado.
- **Rolo:** o tamanho da etiqueta é configurável (default **DK-11201 29×90 mm**, o que está
  em mãos). Para o layout completo do modelo, prefira rolos de **62 mm** (DK-22205/DK-11202).
  Conteúdo em preto (a QL-800 é monocromática); o estado (VERDE/AZUL/AMARELO/VERMELHO/QRT)
  aparece como texto.

## Configuração local
1. `npm install`
2. Copie `.env.example` para `.env` e preencha:
   ```
   VITE_SUPABASE_URL=https://yqimfktanresuboqfdti.supabase.co
   VITE_SUPABASE_ANON_KEY=<chave publishable do projeto>
   ```
   A chave publishable está em: Supabase → Project Settings → API → Project API keys.
3. `npm run dev` e abra http://localhost:5173

## Deploy na Vercel
1. Importe este repositório na Vercel (Framework: **Vite**).
2. Em *Environment Variables*, defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Deploy. O `vercel.json` já cuida do roteamento SPA.

## Criar usuários
No painel Supabase → Authentication → Users → Add user (e-mail + senha) para Pedro e Bárbara.

## Estrutura
- `src/lib/supabase.js` — cliente Supabase
- `src/lib/model.js` — status, classes e helpers
- `src/lib/labels.js` — modelo de dados das etiquetas, rolos DK e geração de QR
- `src/lib/labelPdf.js` — geração de PDF (jsPDF)
- `src/components/labels/` — `LabelCard` (render HTML) e `LabelPrint` (modal de impressão)
- `src/screens/` — Login, Dashboard, ItemsScreen, ItemDetail
- `src/App.jsx` — auth, navegação e realtime

## Banco de dados
Tabelas: `lotes`, `itens`, `fotos`, `eventos`. RLS ativo (só usuários autenticados).
Bucket de fotos privado: `fotos-produtos`.
