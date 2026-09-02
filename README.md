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
- **Planilha de produtos** — listagem tabular de todos os campos do item, com
  filtro, escolha de colunas, edição na própria célula e exportação para **Excel
  (.xlsx)**.
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

## Planilha de produtos (aba **Planilha**)
Tela única para consultar, corrigir e exportar o cadastro sem sair da listagem:
- **Filtrar:** busca livre (SKU, produto, marca, modelo, GTIN, caixa) + filtros de
  lote, status, classe, categoria e destino. Por padrão só o estoque ativo aparece;
  marque *Incluir vendidos, entregues e descartados* para ver o resto.
- **Escolher as colunas:** botão de colunas → 60 campos agrupados (Identificação,
  Classificação, Atributos, Anúncio, Preço, Venda, Medidas, Fluxo, Auditoria).
  Atalhos *Todas / Padrão / Mínimo*; a escolha fica salva no navegador.
  **SKU** e **Produto** ficam presos à esquerda na rolagem horizontal.
- **Consultar e alterar:** toque numa célula editável para alterar direto na grade
  (texto, número em formato pt-BR, lista de opções, sim/não). Mudança de status
  grava o evento de auditoria e carimba `vendido_em` / `entregue_em`, igual à ficha.
- **Abrir a ficha:** o nome do produto é link para a tela completa do item; o lápis
  ao lado edita só o nome ali mesmo.
- **Exportar Excel:** gera um `.xlsx` de verdade (cabeçalho fixo, filtro automático,
  largura de coluna, moeda em R$ e datas como data) com **todas as linhas filtradas**
  — não só as que estão em tela — nas colunas visíveis ou nas 60 do catálogo.
  O gerador (`src/lib/xlsx.js`) não usa nenhuma dependência externa.

> A aba **Exportar** continua sendo o caminho do integrador (CSV para Bling / Tiny /
> Magis5 / ANYMARKET e flat file da Amazon). A **Planilha** é para trabalho interno:
> conferir e corrigir o cadastro, e mandar a lista para quem não usa o app.

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
- `src/lib/planilha.js` — catálogo das colunas da planilha (rótulo, tipo, edição, export)
- `src/lib/xlsx.js` — gerador de `.xlsx` (ZIP + OOXML) sem dependências
- `src/screens/` — Login, Dashboard, ItemsScreen, ItemDetail, PlanilhaScreen
- `src/App.jsx` — auth, navegação e realtime

## Banco de dados
Tabelas: `lotes`, `itens`, `fotos`, `eventos`. RLS ativo (só usuários autenticados).
Bucket de fotos privado: `fotos-produtos`.
