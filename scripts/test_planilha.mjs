// Planilha de produtos (src/lib/planilha.js): catálogo de colunas, escolha de
// colunas visíveis, edição na célula, ordenação/busca e montagem do .xlsx.
// O contrato central: o que a tela mostra é exatamente o que vai para o Excel.
import assert from "node:assert";
import {
  COLUNAS_PLANILHA, COLUNAS_PADRAO, COLUNAS_FIXAS, GRUPOS_COLUNAS, CLASSES, MEDIDAS_FONTE_OPCOES,
  coluna, colunasVisiveis, normalizarVisiveis, montarPatch, montarPlanilha, nomeArquivo,
  valorBruto, valorExcel, valorTexto, valorEdicao, estiloExcel, parseNumero, parseBool, boolTexto,
  filtrarPorTexto, ordenarItens,
} from "../src/lib/planilha.js";
import { ALL_STATUS } from "../src/lib/model.js";
import { ESTILO, gerarXlsx } from "../src/lib/xlsx.js";

const TIPOS = ["texto", "texto_longo", "inteiro", "decimal", "moeda", "bool", "select", "data", "lista"];

// 1) Catálogo consistente: chave única, rótulo, grupo conhecido e tipo válido.
{
  const chaves = COLUNAS_PLANILHA.map((c) => c.key);
  assert.equal(new Set(chaves).size, chaves.length, "há chave de coluna duplicada");
  for (const c of COLUNAS_PLANILHA) {
    assert.ok(c.header && typeof c.header === "string", `coluna ${c.key} sem rótulo`);
    assert.ok(GRUPOS_COLUNAS.includes(c.grupo), `coluna ${c.key} com grupo fora da lista`);
    assert.ok(TIPOS.includes(c.tipo), `coluna ${c.key} com tipo inválido: ${c.tipo}`);
    assert.equal(typeof c.get, "function", `coluna ${c.key} sem leitor`);
    if (c.tipo === "select") assert.ok(c.opcoes?.length, `select ${c.key} sem opções`);
    // Data/lista/derivadas não são editáveis na célula (viriam do fluxo, não da digitação).
    if (c.editavel) assert.ok(!["data", "lista"].includes(c.tipo), `${c.key} não deveria ser editável`);
  }
  // As opções de status vêm da máquina de estados (fonte única em model.js).
  assert.deepEqual(coluna("status").opcoes.map((o) => o.v), ALL_STATUS.map((s) => s.id));
  assert.deepEqual(CLASSES, ["A+", "A", "B", "C", "D", "E"]);
  assert.deepEqual(MEDIDAS_FONTE_OPCOES.map(([v]) => v), ["MEDIDO", "ESTIMADO", "A_MEDIR"]);
}

// 2) Colunas padrão/fixas existem no catálogo; as fixas identificam a linha.
{
  for (const k of COLUNAS_PADRAO) assert.ok(coluna(k), `coluna padrão inexistente: ${k}`);
  // A lista padrão já vem na ordem do catálogo (evita a grade "pular" ao normalizar).
  assert.deepEqual(normalizarVisiveis(COLUNAS_PADRAO), COLUNAS_PADRAO);
  assert.deepEqual(COLUNAS_FIXAS, ["sku", "produto"]);
  for (const k of COLUNAS_FIXAS) assert.ok(COLUNAS_PADRAO.includes(k));
}

// 3) Escolha de colunas: ignora chave desconhecida, força as fixas, ordem do catálogo.
{
  assert.deepEqual(normalizarVisiveis(["status", "marca", "inexistente"]),
    ["sku", "produto", "marca", "status"]);
  // Tentar esconder as fixas não funciona (Produto é o link para a ficha).
  assert.ok(normalizarVisiveis(["preco_ideal"]).includes("produto"));
  assert.deepEqual(normalizarVisiveis([]), COLUNAS_PADRAO);
  assert.deepEqual(normalizarVisiveis(null), COLUNAS_PADRAO);
  assert.deepEqual(colunasVisiveis(["marca"]).map((c) => c.key), ["sku", "produto", "marca"]);
}

// 4) Conversão de números digitados (pt-BR e formato "cru").
{
  assert.equal(parseNumero("1.234,56"), 1234.56);
  assert.equal(parseNumero("1234.56"), 1234.56);
  assert.equal(parseNumero("R$ 89,90"), 89.9);
  assert.equal(parseNumero(""), null);
  assert.equal(parseNumero("abc"), null);
  assert.equal(parseBool("true"), true);
  assert.equal(parseBool("false"), false);
  assert.equal(parseBool(""), null);
  assert.equal(boolTexto(true), "Sim");
  assert.equal(boolTexto(false), "Não");
  assert.equal(boolTexto(null), "");
}

// 5) Edição na célula → patch para o banco (ou erro legível).
{
  const it = { sku: "NOG-001-001", produto: "Cafeteira" };
  assert.deepEqual(montarPatch(coluna("marca"), " Philco "), { patch: { marca: "Philco" } });
  assert.deepEqual(montarPatch(coluna("marca"), "   "), { patch: { marca: null } });
  assert.deepEqual(montarPatch(coluna("preco_ideal"), "1.299,90"), { patch: { preco_ideal: 1299.9 } });
  assert.deepEqual(montarPatch(coluna("quantidade"), "3,4"), { patch: { quantidade: 3 } });
  assert.deepEqual(montarPatch(coluna("testado"), "false"), { patch: { testado: false } });
  assert.deepEqual(montarPatch(coluna("status"), "PRONTO"), { patch: { status: "PRONTO" } });
  assert.deepEqual(montarPatch(coluna("status"), ""), { patch: { status: null } });
  assert.ok(montarPatch(coluna("preco_ideal"), "abc").erro, "texto em campo numérico deveria falhar");
  assert.ok(montarPatch(coluna("preco_ideal"), "-5").erro, "preço negativo deveria falhar");
  assert.ok(montarPatch(coluna("status"), "INVENTADO").erro, "status fora da lista deveria falhar");
  assert.ok(montarPatch(coluna("lote"), "9").erro, "coluna somente leitura deveria recusar edição");
  // `produto` é NOT NULL no banco: em branco não grava e avisa.
  const vazio = montarPatch(coluna("produto"), "");
  assert.deepEqual(vazio.patch, {});
  assert.ok(vazio.aviso);
  assert.equal(it.produto, "Cafeteira");
}

// 6) Leitura: valor bruto, texto da tela e valor da célula do Excel.
{
  const it = {
    sku: "NOG-001-001", produto: "Cafeteira", preco_ideal: 129.9, quantidade: 2,
    peso_kg: 3.2, foto_feita: true, anuncio_feito: false, status: "PRONTO",
    cond_embalagem: "LEVE", vendido_em: "2026-09-02T13:00:00.000Z",
    bullet_points: ["Leve", "Rápida"], ficha_tecnica: [{ atributo: "Potência", valor: "800W" }],
    marca: null,
  };
  assert.equal(valorBruto(coluna("preco_ideal"), it), 129.9);
  // peso_real_kg cai no peso_kg legado da planilha-mãe quando não foi pesado.
  assert.equal(valorBruto(coluna("peso_real_kg"), it), 3.2);

  assert.equal(valorExcel(coluna("preco_ideal"), it), 129.9);          // número, não texto
  assert.equal(valorExcel(coluna("foto_feita"), it), "Sim");
  assert.equal(valorExcel(coluna("anuncio_feito"), it), "Não");
  assert.equal(valorExcel(coluna("status"), it), "Pronto p/ anúncio");  // rótulo, não código
  assert.equal(valorExcel(coluna("cond_embalagem"), it), "Levemente avariada");
  assert.equal(valorExcel(coluna("bullet_points"), it), "Leve | Rápida");
  assert.equal(valorExcel(coluna("ficha_tecnica"), it), "Potência: 800W");
  assert.ok(valorExcel(coluna("vendido_em"), it) instanceof Date, "data deveria virar Date");
  assert.equal(valorExcel(coluna("marca"), it), null);                  // vazio some da célula

  assert.equal(valorTexto(coluna("marca"), it), "—");
  assert.equal(valorTexto(coluna("status"), it), "Pronto p/ anúncio");
  assert.equal(valorTexto(coluna("foto_feita"), it), "Sim");
  assert.ok(valorTexto(coluna("preco_ideal"), it).includes("129,90"));

  assert.equal(valorEdicao(coluna("foto_feita"), it), "true");
  assert.equal(valorEdicao(coluna("marca"), it), "");
  assert.equal(valorEdicao(coluna("preco_ideal"), it), "129.9");
}

// 7) Estilo do Excel por tipo (moeda em R$, inteiro sem casas, data como data).
{
  assert.equal(estiloExcel(coluna("preco_ideal")), ESTILO.MOEDA);
  assert.equal(estiloExcel(coluna("quantidade")), ESTILO.INTEIRO);
  assert.equal(estiloExcel(coluna("peso_real_kg")), ESTILO.DECIMAL);
  assert.equal(estiloExcel(coluna("vendido_em")), ESTILO.DATA);
  assert.equal(estiloExcel(coluna("marca")), ESTILO.GERAL);
}

// 8) Busca textual varre os campos de identificação do item.
{
  const itens = [
    { sku: "NOG-001-001", produto: "Cafeteira", marca: "Philco", gtin: "7891234567895" },
    { sku: "NOG-001-002", produto: "Fone de ouvido", marca: "JBL" },
  ];
  assert.equal(filtrarPorTexto(itens, "cafe").length, 1);
  assert.equal(filtrarPorTexto(itens, "JBL").length, 1);
  assert.equal(filtrarPorTexto(itens, "789123").length, 1);
  assert.equal(filtrarPorTexto(itens, "NOG-001").length, 2);
  assert.equal(filtrarPorTexto(itens, "  ").length, 2);
}

// 9) Ordenação: número compara como número e vazio fica no fim nos dois sentidos.
{
  const itens = [
    { sku: "A", preco_ideal: 90 },
    { sku: "B", preco_ideal: 1000 },
    { sku: "C", preco_ideal: null },
  ];
  const col = coluna("preco_ideal");
  assert.deepEqual(ordenarItens(itens, col, "asc").map((i) => i.sku), ["A", "B", "C"]);
  assert.deepEqual(ordenarItens(itens, col, "desc").map((i) => i.sku), ["B", "A", "C"]);
  // Texto usa collation pt-BR (acento não joga o item para o fim da lista).
  const nomes = [{ produto: "Zebra" }, { produto: "Água" }, { produto: "Banana" }];
  assert.deepEqual(ordenarItens(nomes, coluna("produto"), "asc").map((i) => i.produto),
    ["Água", "Banana", "Zebra"]);
  // Não muta o array original.
  const orig = [...itens];
  ordenarItens(itens, col, "desc");
  assert.deepEqual(itens, orig);
}

// 10) montarPlanilha alimenta o gerador de .xlsx com colunas e linhas alinhadas.
{
  const itens = [
    { sku: "NOG-001-001", produto: "Cafeteira", preco_ideal: 129.9, status: "PRONTO" },
    { sku: "NOG-001-002", produto: "Fone", preco_ideal: null, status: "TRIADO" },
  ];
  const cols = colunasVisiveis(["preco_ideal", "status"]);
  const { colunas, linhas } = montarPlanilha(itens, cols);
  assert.deepEqual(colunas.map((c) => c.header), ["SKU", "Produto", "Preço de venda", "Status"]);
  assert.equal(colunas[2].estilo, ESTILO.MOEDA);
  assert.equal(linhas.length, 2);
  for (const l of linhas) assert.equal(l.length, colunas.length, "linha com nº de células diferente do cabeçalho");
  assert.deepEqual(linhas[0], ["NOG-001-001", "Cafeteira", 129.9, "Pronto p/ anúncio"]);
  assert.deepEqual(linhas[1], ["NOG-001-002", "Fone", null, "Triado"]);
  // Ponta a ponta: o .xlsx sai com os rótulos e o número como número.
  const xlsx = Buffer.from(gerarXlsx({ aba: "Produtos", colunas, linhas })).toString("utf8");
  assert.ok(xlsx.includes("Preço de venda"));
  assert.ok(xlsx.includes("<v>129.9</v>"));
}

// 11) Exportar TODAS as colunas continua alinhado com o catálogo.
{
  const { colunas, linhas } = montarPlanilha([{ sku: "NOG-001-001", produto: "X" }], COLUNAS_PLANILHA);
  assert.equal(colunas.length, COLUNAS_PLANILHA.length);
  assert.equal(linhas[0].length, COLUNAS_PLANILHA.length);
}

// 12) Nome do arquivo carrega os filtros aplicados e a data.
{
  const dia = new Date("2026-09-02T12:00:00Z");
  assert.equal(nomeArquivo({}, dia), "nogaria-produtos-2026-09-02.xlsx");
  assert.equal(nomeArquivo({ lote: "12", status: "PRONTO" }, dia), "nogaria-produtos-lote12-pronto-2026-09-02.xlsx");
  assert.equal(nomeArquivo({ grupo: "Eletroportáteis / Cozinha" }, dia),
    "nogaria-produtos-eletroport-teis-cozinha-2026-09-02.xlsx");
}

console.log("✓ planilha: catálogo, colunas visíveis, edição, ordenação e export .xlsx");
