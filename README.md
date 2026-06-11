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
- `src/screens/` — Login, Dashboard, ItemsScreen, ItemDetail
- `src/App.jsx` — auth, navegação e realtime

## Banco de dados
Tabelas: `lotes`, `itens`, `fotos`, `eventos`. RLS ativo (só usuários autenticados).
Bucket de fotos privado: `fotos-produtos`.
