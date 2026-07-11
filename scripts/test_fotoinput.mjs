// Regressão: adicionar foto da galeria no iPhone falhava silenciosamente.
//
// No iOS Safari/WebKit, input.files é um FileList "vivo" ligado ao elemento:
// setar input.value = "" esvazia esse MESMO objeto na hora. Se o código guardar
// só a referência antes de limpar, ao ler files.length depois já é 0 — a foto
// é descartada sem upload e sem erro (falha silenciosa). pegarArquivos precisa
// copiar os arquivos ANTES de limpar o input.
import assert from "node:assert";
import { pegarArquivos } from "../src/lib/fileInput.js";

// Emula o <input> do iOS: o mesmo array de files é esvaziado IN PLACE quando
// value vira "" (como o FileList vivo do WebKit).
function makeIOSInput(fileNames) {
  const files = fileNames.map((name) => ({ name }));
  return {
    get files() { return files; },
    set value(v) { if (v === "") files.length = 0; },
    get value() { return ""; },
  };
}

// 1) Preserva os arquivos apesar da semântica de FileList vivo do iOS.
{
  const input = makeIOSInput(["IMG_0001.jpg", "IMG_0002.jpg"]);
  const out = pegarArquivos(input);
  assert.equal(out.length, 2, "deveria preservar os 2 arquivos (regressão iOS)");
  assert.equal(out[0].name, "IMG_0001.jpg");
}

// 2) Limpa o input para permitir re-seleção do mesmo arquivo.
{
  const input = makeIOSInput(["IMG_0003.jpg"]);
  pegarArquivos(input);
  assert.equal(input.files.length, 0, "input deve ficar limpo após a leitura");
}

// 3) Sem arquivos → array vazio, sem lançar.
{
  const input = makeIOSInput([]);
  assert.deepEqual(pegarArquivos(input), []);
}

console.log("test_fotoinput OK");
