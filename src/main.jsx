import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import CatalogoPublicoView from "./screens/CatalogoPublicoView.jsx";
import "./index.css";

// Rota pública do catálogo compartilhado: /c/<slug>. Renderiza SEM o gate de login.
const m = window.location.pathname.match(/^\/c\/([^/]+)/);
const raiz = ReactDOM.createRoot(document.getElementById("root"));

raiz.render(
  <React.StrictMode>
    {m ? <CatalogoPublicoView slug={decodeURIComponent(m[1])} /> : <App />}
  </React.StrictMode>
);
