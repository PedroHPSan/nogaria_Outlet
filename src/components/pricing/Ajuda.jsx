import React, { useState } from "react";
import { HelpCircle } from "lucide-react";
import { GLOSSARIO } from "./glossario";

// Botão "?" que abre/fecha uma definição curta inline (tap-friendly p/ mobile —
// não depende de hover). `termo` busca no GLOSSARIO; `texto` sobrescreve.
export default function Ajuda({ termo, texto, className = "" }) {
  const [aberto, setAberto] = useState(false);
  const def = texto || GLOSSARIO[termo];
  if (!def) return null;
  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label="O que é isso?"
        aria-expanded={aberto}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAberto((o) => !o); }}
        className={`inline-flex items-center justify-center rounded-full ${aberto ? "text-orange-600" : "text-gray-400"} hover:text-orange-600`}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {aberto && (
        <span
          role="tooltip"
          className="absolute z-20 left-0 top-5 w-56 rounded-lg bg-gray-900 text-white text-[11px] leading-snug p-2.5 shadow-lg"
        >
          {def}
        </span>
      )}
    </span>
  );
}
