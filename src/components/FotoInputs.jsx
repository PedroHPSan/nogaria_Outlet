import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { pegarArquivos } from "../lib/fileInput";

// Dois inputs de arquivo ocultos que compartilham o mesmo handler de fotos.
// - "câmera": capture="environment" → abre a câmera direto (atalho no mobile).
// - "galeria": SEM capture → deixa o SO oferecer a galeria/arquivos.
// Exposto por ref: abrirCamera() / abrirGaleria(). `onFiles` recebe o FileList.
const FotoInputs = forwardRef(function FotoInputs({ onFiles }, ref) {
  const camRef = useRef();
  const galRef = useRef();

  useImperativeHandle(ref, () => ({
    abrirCamera: () => camRef.current?.click(),
    abrirGaleria: () => galRef.current?.click(),
  }));

  const handle = (e) => {
    // Copia os arquivos ANTES de limpar o input — no iOS o FileList é vivo e
    // seria esvaziado por pegarArquivos ao resetar value (falha silenciosa).
    const files = pegarArquivos(e.target);
    if (files.length) onFiles(files);
  };

  return (
    <>
      <input ref={camRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={handle} />
      <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={handle} />
    </>
  );
});

export default FotoInputs;
