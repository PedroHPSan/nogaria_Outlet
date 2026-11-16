// Gestores de venda (tabela gestores_venda, hoje Bárbara e Valentina): só eles trocam o preço de venda depois do
// cadastro inicial e cancelam separação. A trava de verdade é no banco (triggers da migration 20261116100000);
// aqui é só para esconder/travar os controles na tela.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

let cache = null; // Promise<boolean> por sessão de página

export function podeGerirVenda() {
  if (!cache) {
    cache = supabase.rpc("pode_gerir_venda").then(({ data, error }) => (error ? false : data === true));
  }
  return cache;
}

export const limparPermissoes = () => { cache = null; };

export function usePodeGerirVenda() {
  const [pode, setPode] = useState(false);
  useEffect(() => {
    let vivo = true;
    podeGerirVenda().then((v) => { if (vivo) setPode(v); });
    return () => { vivo = false; };
  }, []);
  return pode;
}

export const MSG_SO_GESTOR_PRECO = "Só Bárbara e Valentina podem alterar o preço de venda depois do cadastro.";
export const MSG_SO_GESTOR_SEPARACAO = "Só Bárbara e Valentina podem cancelar a separação do item.";
