import React from "react";
import { LOGO_ICON, LOGO_ICON_RATIO } from "../../lib/logo";

// Renderiza UMA etiqueta no tamanho físico do rolo (mm), preto sobre branco.
// Compacto (rolos de 29 mm) = layout vertical empilhado.
// Completo (62 mm+) = cabeçalho + campos + QR ao lado + checkboxes no rodapé.

const mm = (v) => `${v}mm`;

function Checkboxes({ items, size = 7 }) {
  return (
    <div
      style={{
        display: "flex",
        gap: mm(1.5),
        flexWrap: "wrap",
        marginTop: mm(1),
      }}
    >
      {items.map((c) => (
        <span
          key={c}
          style={{ display: "inline-flex", alignItems: "center", gap: mm(0.7) }}
        >
          <span
            style={{
              display: "inline-block",
              width: mm(2.6),
              height: mm(2.6),
              border: "0.3mm solid #000",
            }}
          />
          <span style={{ fontSize: `${size}pt`, fontWeight: 700 }}>{c}</span>
        </span>
      ))}
    </div>
  );
}

function EstadoBox({ texto, fontSize }) {
  return (
    <div
      style={{
        border: "0.4mm solid #000",
        borderRadius: mm(1),
        padding: `${mm(0.6)} ${mm(1.2)}`,
        fontWeight: 800,
        fontSize: `${fontSize}pt`,
        textAlign: "center",
        letterSpacing: "0.2px",
      }}
    >
      {texto}
    </div>
  );
}

function Qr({ data, size }) {
  if (!data) {
    return (
      <div
        style={{
          width: mm(size),
          height: mm(size),
          border: "0.3mm solid #000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "5pt",
        }}
      >
        QR
      </div>
    );
  }
  return (
    <img
      src={data}
      alt="QR"
      style={{
        width: mm(size),
        height: mm(size),
        imageRendering: "pixelated",
      }}
    />
  );
}

// --- Layout compacto (29 mm) ---------------------------------------------
// Sem checkboxes de marcação: prioriza identificação e localização, com fontes
// maiores e informações condensadas (uma linha por campo, sem quebras).
const nowrap = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function CompactProduct({ label }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Qr data={label.qrData} size={20} />
      </div>
      <div
        style={{
          fontFamily: "monospace",
          fontWeight: 800,
          fontSize: "10pt",
          textAlign: "center",
          marginTop: mm(1),
          whiteSpace: "nowrap",
          lineHeight: 1.1,
        }}
      >
        {label.sku}
      </div>
      <div style={{ fontSize: "7pt", textAlign: "center", marginBottom: mm(1.2) }}>
        Lote {label.lote}
        {label.classe ? ` · Classe ${label.classe}` : ""}
      </div>
      <div style={{ fontSize: "8.5pt", fontWeight: 700, marginTop: mm(0.4), lineHeight: 1.2 }}>
        {label.produto}
      </div>
      <div style={{ fontSize: "7.5pt", marginTop: mm(1.4), lineHeight: 1.45 }}>
        <div style={nowrap}>Caixa <b>{label.caixa_num}</b> · Local <b>{label.local_fisico}</b></div>
        <div style={nowrap}>Destino <b>{label.destino}</b></div>
      </div>
      {label.aviso && (
        <div
          style={{
            fontSize: "7pt",
            fontWeight: 800,
            marginTop: mm(1.2),
            border: "0.4mm solid #000",
            padding: mm(0.9),
            textAlign: "center",
          }}
        >
          {label.aviso}
        </div>
      )}
    </>
  );
}

function CompactBox({ label }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Qr data={label.qrData} size={18} />
      </div>
      <div
        style={{
          fontFamily: "monospace",
          fontWeight: 800,
          fontSize: "9.5pt",
          textAlign: "center",
          marginTop: mm(0.8),
          whiteSpace: "nowrap",
        }}
      >
        {label.sku}
      </div>
      <div style={{ fontSize: "7pt", textAlign: "center", fontWeight: 700, marginBottom: mm(1) }}>
        {label.tipo === "MALA" ? "MALA" : "CAIXA"} · {label.qtd} itens
      </div>
      <div style={{ fontSize: "6.5pt" }}>
        <div>Local: <b>{label.local_fisico}</b></div>
        <div>Destino: <b>{label.destino}</b></div>
        {label.lotes?.length > 0 && <div>Lotes: {label.lotes.join(", ")}</div>}
      </div>
      <div style={{ fontSize: "6pt", marginTop: mm(1.2), textAlign: "center", fontWeight: 700 }}>
        Escaneie o QR para ver o conteúdo
      </div>
    </>
  );
}

// --- Layout completo (62 mm+) --------------------------------------------
function FullProduct({ label, tall = false }) {
  return (
    <>
      <div style={{ display: "flex", gap: mm(2) }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: tall ? "12pt" : "11pt", whiteSpace: "nowrap" }}>
            {label.sku}
          </div>
          <div style={{ fontSize: tall ? "8pt" : "7.5pt", marginBottom: mm(0.8) }}>
            Lote {label.lote}
            {label.classe ? ` · Classe ${label.classe}` : ""} · Caixa/Mala: {label.caixa_num} · Local: {label.local_fisico}
          </div>
        </div>
        <Qr data={label.qrData} size={tall ? 26 : 20} />
      </div>
      <EstadoBox texto={label.estadoTexto} fontSize={tall ? 9 : 8} />
      <div style={{ fontSize: tall ? "11pt" : "9pt", fontWeight: 700, marginTop: mm(1.2), lineHeight: 1.2 }}>
        {label.produto}
      </div>
      {tall && label.medidas && (
        <div style={{ fontSize: "9pt", marginTop: mm(1) }}>
          Medidas: <b>{label.medidas}</b>
        </div>
      )}
      <div style={{ fontSize: tall ? "9pt" : "8pt", marginTop: mm(1) }}>
        Destino: <b>{label.destino}</b>
      </div>
      {label.aviso && (
        <div
          style={{
            fontSize: tall ? "9pt" : "8pt",
            fontWeight: 800,
            marginTop: mm(1),
            border: "0.4mm solid #000",
            padding: mm(1),
            textAlign: "center",
          }}
        >
          {label.aviso}
        </div>
      )}
      {/* Empurra os checkboxes para o rodapé, ocupando o espaço vazio do 62×100. */}
      {tall && <div style={{ flexGrow: 1, minHeight: mm(2) }} />}
      <Checkboxes items={label.checkboxes} size={tall ? 9 : 7.5} />
    </>
  );
}

function FullBox({ label, tall = false }) {
  return (
    <>
      <div style={{ display: "flex", gap: mm(2) }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: tall ? "15pt" : "12pt", whiteSpace: "nowrap" }}>
            {label.sku}
          </div>
          <div style={{ fontSize: tall ? "9pt" : "8pt", fontWeight: 700 }}>
            {label.tipo === "MALA" ? "MALA" : "CAIXA"} · {label.qtd} itens
          </div>
        </div>
        <Qr data={label.qrData} size={tall ? 28 : 20} />
      </div>
      <div style={{ fontSize: tall ? "9pt" : "8pt", marginTop: mm(1) }}>
        <div>Local: <b>{label.local_fisico}</b> · Destino: <b>{label.destino}</b></div>
        {!tall && label.lotes?.length > 0 && <div>Lotes: {label.lotes.join(", ")}</div>}
      </div>
      {tall && (label.classeResumo || label.loteResumo) && (
        <div style={{ fontSize: "9pt", marginTop: mm(1.4), lineHeight: 1.5 }}>
          {label.classeResumo && <div>Classes: <b>{label.classeResumo}</b></div>}
          {label.loteResumo && <div>Por lote: <b>{label.loteResumo}</b></div>}
        </div>
      )}
      {tall && <div style={{ flexGrow: 1, minHeight: mm(2) }} />}
      <div style={{ fontSize: tall ? "8.5pt" : "7.5pt", marginTop: mm(1.4), fontWeight: 700 }}>
        Escaneie o QR para ver o conteúdo da {label.tipo === "MALA" ? "mala" : "caixa"}.
      </div>
    </>
  );
}

export default function LabelCard({ label, preset, preview = false }) {
  const compact = preset.compact;
  // Etiqueta "alta" (DK-11202, 62×100): aproveita o espaço extra com QR/fontes
  // maiores e campos adicionais. Não afeta os formatos completos curtos (62×50, 100×50).
  const tall = !compact && preset.height >= 80;
  const isBox = label.tipo === "CAIXA" || label.tipo === "MALA";
  return (
    <div
      className={`label-card label-page${preview ? " label-preview" : ""}`}
      style={{
        width: mm(preset.width),
        height: mm(preset.height),
        boxSizing: "border-box",
        padding: mm(compact ? 1.6 : 2.4),
        // Margem superior maior: a impressora térmica corta o topo e cortava o
        // cabeçalho "NOGÁRIA OUTLET". Empurra o conteúdo para baixo da zona morta.
        paddingTop: mm(compact ? 3.6 : 4),
        color: "#000",
        background: "#fff",
        overflow: "hidden",
        fontFamily: "Arial, Helvetica, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: mm(compact ? 1.2 : 1.6),
          borderBottom: "0.3mm solid #000",
          paddingBottom: mm(0.6),
          marginBottom: mm(1),
        }}
      >
        <img
          src={LOGO_ICON}
          alt="NOGÁRIA"
          style={{
            height: mm(compact ? 4 : 5),
            width: mm((compact ? 4 : 5) * LOGO_ICON_RATIO),
            flexShrink: 0,
            display: "block",
          }}
        />
        <span
          style={{
            fontSize: compact ? "5.5pt" : "7pt",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.2px",
            lineHeight: 1.1,
          }}
        >
          {label.titulo}
        </span>
      </div>
      {compact
        ? isBox
          ? <CompactBox label={label} />
          : <CompactProduct label={label} />
        : isBox
          ? <FullBox label={label} tall={tall} />
          : <FullProduct label={label} tall={tall} />}
    </div>
  );
}
