// React.lazy com proteção contra falha de carregamento do pedaço (chunk) do código.
//
// Por que existe: cada deploy na Vercel gera arquivos novos em /assets com outro hash. Quem está
// com o app aberto desde antes do deploy ainda pede os arquivos antigos; o rewrite "/(.*)" devolve
// o index.html no lugar e o import() falha. Sem tratamento, o erro sobe até a raiz, o React
// desmonta o app inteiro (tela branca) e o usuário perde o que estava preenchendo na ficha.
//
// Aqui: tenta de novo uma vez (falha de rede passageira) e, se ainda falhar, devolve um aviso no
// lugar do modal, com botão para fechar. O restante da tela (e o formulário aberto) continua vivo.
import React from "react";

// eslint-disable-next-line react-refresh/only-export-components -- componente interno, só usado como fallback
function AvisoFalhaCarregamento({ onClose }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-3 shadow-xl">
        <p className="font-bold text-gray-900">Não foi possível abrir esta função</p>
        <p className="text-sm text-gray-600">
          Provavelmente uma nova versão do sistema foi publicada. <b>Salve o que está fazendo</b> e
          depois recarregue a página para usar esta função.
        </p>
        <div className="flex gap-2">
          {onClose && (
            <button onClick={onClose} className="flex-1 rounded-xl py-2.5 font-semibold border border-gray-300 text-gray-700">
              Fechar
            </button>
          )}
          <button onClick={() => window.location.reload()} className="flex-1 rounded-xl py-2.5 font-bold bg-gray-900 text-white">
            Recarregar agora
          </button>
        </div>
      </div>
    </div>
  );
}

export function lazySeguro(importar) {
  return React.lazy(() =>
    importar()
      .catch(() => new Promise((r) => setTimeout(r, 800)).then(importar))
      .catch((e) => {
        console.error("[lazySeguro] falha ao carregar módulo", e);
        return { default: AvisoFalhaCarregamento };
      })
  );
}
