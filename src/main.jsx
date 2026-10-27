import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import CatalogoPublicoView from "./screens/CatalogoPublicoView.jsx";
import ProdutoPublicoView from "./screens/ProdutoPublicoView.jsx";
import OrcamentoPublicoView from "./screens/OrcamentoPublicoView.jsx";
import "./index.css";

// Rota pública do catálogo compartilhado: /c/<slug>. Renderiza SEM o gate de login.
const m = window.location.pathname.match(/^\/c\/([^/]+)/);
// Rota pública do orçamento: /o/<slug>.
const mo = window.location.pathname.match(/^\/o\/([^/]+)/);
// Rota pública da oferta (produto/lote para o grupo de WhatsApp): /p/<slug>.
const mp = window.location.pathname.match(/^\/p\/([^/]+)/);
const raiz = ReactDOM.createRoot(document.getElementById("root"));

raiz.render(
  <React.StrictMode>
    {m ? <CatalogoPublicoView slug={decodeURIComponent(m[1])} />
      : mp ? <ProdutoPublicoView slug={decodeURIComponent(mp[1])} />
      : mo ? <OrcamentoPublicoView slug={decodeURIComponent(mo[1])} />
      : <App />}
  </React.StrictMode>
);
