// Lê os arquivos de um <input type="file"> e limpa o input (permitindo
// re-selecionar o MESMO arquivo, já que sem o reset o evento change não
// dispara de novo para uma seleção idêntica).
//
// IMPORTANTE (iOS Safari/WebKit): input.files é um FileList "vivo" ligado ao
// elemento — ao fazer input.value = "" o mesmo FileList é esvaziado na hora.
// Se guardássemos só a referência (const files = input.files) e limpássemos o
// input antes de usá-la, files.length viraria 0 e a foto seria descartada sem
// upload e sem erro (falha silenciosa no iPhone). Por isso copiamos com
// Array.from ANTES de limpar: o array é independente e sobrevive ao reset.
export function pegarArquivos(input) {
  const files = Array.from(input?.files || []);
  if (input) input.value = "";
  return files;
}
