# Como subir este projeto para o GitHub

Os arquivos estão prontos. No seu computador, dentro da pasta do projeto:

```bash
git init
git add .
git commit -m "App NOGÁRIA OUTLET: catálogo + checklist (Vite + React + Supabase)"
git branch -M main
git remote add origin https://github.com/PedroHPSan/nogaria_Outlet.git
git push -u origin main
```

Se o repositório já tiver commits, use `git pull --rebase origin main` antes do push,
ou `git push -u origin main --force` se quiser sobrescrever (cuidado: apaga o que estava lá).

Depois é só importar na Vercel e definir as duas variáveis de ambiente (ver README).
