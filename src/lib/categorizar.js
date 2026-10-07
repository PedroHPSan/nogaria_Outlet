// categorizar.js — sugestão offline de categoria a partir do texto do produto.
// Casa o nome do produto contra as categorias de pricing_grupo (params.grupos),
// usando um dicionário de sinônimos de alta precisão + fallback pelos termos do
// próprio nome da categoria. Na dúvida retorna null (não chuta).

const norm = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Palavras genéricas demais para virar chave automática a partir do nome.
const STOP = new Set([
  "nao", "classificado", "diversos", "info", "para", "com", "dos", "das",
  "outros", "geral", "eletrico", "eletrica", "eletronicos",
]);

// Sinônimos por categoria (chaves = nomes EXATOS de pricing_grupo). Termos sem
// acento/minúsculos; frases com espaço valem mais (sinal mais específico).
const SINONIMOS = {
  "Air fryer/Fritadeira": ["air fryer", "airfryer", "fritadeira"],
  "Ar-condicionado": ["ar condicionado", "ar-condicionado", "split", "condicionado"],
  "Aspirador": ["aspirador de po", "aspirador"],
  "Robô aspirador": ["robo aspirador", "aspirador robo"],
  "Áudio profissional": ["mesa de som", "interface de audio", "microfone condensador", "amplificador", "mixer de audio"],
  "Autopeças": ["autopeca", "parachoque", "retrovisor", "pastilha de freio", "farol", "amortecedor", "virabrequim", "filtro de oleo"],
  "Balanças": ["balanca"],
  "Bebedouro/Purificador": ["bebedouro", "purificador de agua", "purificador"],
  "Beleza/Cuidados pessoais": ["secador de cabelo", "chapinha", "barbeador", "aparador de pelo", "escova alisadora", "depilador"],
  "Bicicleta": ["bicicleta", "bike"],
  "Brinquedos/Infantil": ["brinquedo", "pelucia", "boneca", "boneco", "lego", "quebra cabeca"],
  "Cadeira escritório/gamer": ["cadeira gamer", "cadeira de escritorio", "cadeira office", "cadeira presidente"],
  "Caixa de som": ["caixa de som", "caixa bluetooth", "speaker", "soundbar", "jbl"],
  "Calçados": ["tenis", "sapato", "sandalia", "chinelo", "bota", "sapatenis", "loafer", "calcado", "sapatilha"],
  "Cama/Mesa/Banho": ["jogo de cama", "toalha", "lencol", "edredom", "cobertor", "fronha", "colcha", "travesseiro"],
  "Câmeras/Segurança": ["camera de seguranca", "cftv", "camera ip", "camera de monitoramento"],
  "Camping/Tático": ["barraca de camping", "camping", "lanterna tatica", "canivete", "faca tatica"],
  "Carregadores/Acessórios eletrônicos": ["carregador", "cabo usb", "power bank", "powerbank", "hub usb", "adaptador usb", "fonte de alimentacao"],
  "Climatizador": ["climatizador"],
  "Coifa/Depurador": ["coifa", "depurador"],
  "Colchão inflável": ["colchao inflavel"],
  "Compressor de ar": ["compressor de ar", "compressor"],
  "Computador/All-in-One": ["all in one", "all-in-one", "desktop", "pc gamer", "computador"],
  "Cooktop": ["cooktop", "fogao"],
  "Cosméticos/Perfumaria": ["perfume", "batom", "maquiagem", "blush", "iluminador", "paleta", "base liquida", "rimel", "delineador"],
  "Decoração/Festas": ["decoracao", "quadro decorativo", "luminaria decorativa", "painel de festa", "enfeite"],
  "Eletroportáteis cozinha": ["liquidificador", "batedeira", "mixer", "processador de alimentos", "cafeteira", "sanduicheira", "espremedor", "panela eletrica", "chaleira eletrica"],
  "Equip. médico/odonto": ["aparelho de pressao", "oximetro", "nebulizador", "inalador", "autoclave", "odonto"],
  "Escada": ["escada"],
  "Esporte": ["halter", "anilha", "corda de pular", "luva de boxe", "esteira", "kettlebell"],
  "Ferramentas": ["furadeira", "parafusadeira", "serra", "esmerilhadeira", "lixadeira", "chave de fenda", "alicate", "martelo", "makita", "dewalt", "soprador", "plaina", "tupia", "broca", "jogo de chave"],
  "Fones de ouvido": ["fone de ouvido", "fone bluetooth", "headset", "earbud", "headphone", "tws"],
  "Forno elétrico": ["forno eletrico"],
  "Gabinete PC": ["gabinete gamer", "gabinete pc", "gabinete atx"],
  "Hidráulica/Torneiras": ["torneira", "registro de agua", "chuveiro", "ducha", "sifao", "valvula"],
  "Iluminação/Elétrica": ["lampada", "luminaria", "refletor led", "fita led", "plafon", "disjuntor", "tomada", "interruptor"],
  "Impressora": ["impressora", "multifuncional", "toner", "cartucho de tinta"],
  "Industrial/Equipamentos": ["motor trifasico", "gerador", "solda mig", "maquina de solda", "industrial"],
  "Infantil volumoso": ["carrinho de bebe", "berco", "bebe conforto", "cadeira para auto", "cadeirinha"],
  "Inversor solar": ["inversor solar", "painel solar", "placa solar"],
  "Lavadora alta pressão": ["alta pressao", "lavadora de alta pressao", "karcher", "wap"],
  "Limpeza elétrica": ["vaporizador", "limpador a vapor", "higienizadora"],
  "Limpeza/Embalagens": ["detergente", "sabao", "saco de lixo", "desinfetante", "papel toalha"],
  "Livros/Papelaria": ["livro", "caderno", "caneta", "papelaria", "caixinha", "lembrancinha", "agenda"],
  "Máquina de gelo": ["maquina de gelo"],
  "Material construção/Fixação": ["parafuso", "bucha", "cimento", "argamassa", "trena", "fita isolante", "abracadeira", "caixilho", "grelha"],
  "Micro-ondas": ["micro-ondas", "micro ondas", "microondas"],
  "Monitor": ["monitor"],
  "Moto/Capacetes": ["capacete", "motocicleta", "pedaleira", "escapamento moto"],
  "Móveis": ["armario", "estante", "rack", "guarda roupa", "comoda", "sofa", "prateleira", "criado mudo"],
  "Notebook": ["notebook", "macbook", "ultrabook", "chromebook"],
  "Organização": ["organizador", "caixa organizadora", "cabide", "mala", "bolsa", "necessaire", "mochila"],
  "Patinete elétrico": ["patinete eletrico", "patinete"],
  "Periféricos informática": ["teclado", "mouse", "webcam", "mousepad", "teclado mecanico"],
  "Pesca": ["vara de pesca", "molinete", "carretilha", "anzol", "isca artificial"],
  "Pet": ["racao", "coleira", "comedouro", "arranhador", "caixa de areia"],
  "Piscina": ["piscina", "bomba de piscina", "filtro de piscina"],
  "Projetor": ["projetor"],
  "Redes/Telecom": ["roteador", "repetidor", "switch", "access point", "modem", "telefone ip", "zigbee", "mesh"],
  "Refrigeração": ["geladeira", "refrigerador", "freezer", "frigobar", "cervejeira", "expositor refrigerado"],
  "Relógios/Joias/Óculos": ["relogio", "smartwatch", "oculos", "colar", "anel", "pulseira", "brinco"],
  "Segurança/Automação": ["fechadura digital", "alarme", "sensor de presenca", "controle de portao", "interfone", "fechadura eletronica"],
  "Smartphone": ["smartphone", "celular", "iphone", "galaxy", "redmi", "moto g", "xiaomi"],
  "Suplementos": ["whey", "creatina", "suplemento", "bcaa", "termogenico", "colageno"],
  "Utensílios cozinha/mesa": ["panela", "talher", "escorredor", "faqueiro", "assadeira", "descanso de panela", "jogo de panelas", "forma de bolo"],
  "Ventilador": ["ventilador"],
  "Vestuário": ["camiseta", "camisa", "calca", "short", "bermuda", "vestido", "sutia", "blusa", "jaqueta", "moletom", "lycra"],
  "Acessórios piscina": ["boia", "flutuador"],
  "Alimentos/Bebidas": ["chocolate", "biscoito", "azeite", "cafe em po"],
};

// ---------------------------------------------------------------------------------------------
// ACESSÓRIO ≠ APARELHO. O nome de um acessório quase sempre cita o aparelho ("Cabo Baseus P/ Iphone",
// "Capa Compatível Galaxy S21"), e o token de marca/modelo puxava o scoring para Smartphone (âncora
// R$ 1.300, classe A+) — o que contamina preço de referência, classe, rateio do lote e as unidades-irmãs.
// Duas defesas, nesta ordem:
//   1) pré-filtro por substantivo de acessório (tem prioridade sobre o scoring);
//   2) neutralização do ALVO DE COMPATIBILIDADE ("para/p/compatível com <aparelho> <modelo>") antes
//      de pontuar, para que o aparelho citado não vote na categoria.
// ---------------------------------------------------------------------------------------------

// Aparelhos (e marcas de aparelho) que aparecem como alvo de compatibilidade.
const APARELHO = "iphone|ipad|galaxy|samsung|xiaomi|redmi|poco|motorola|moto ?[gez]\\d*|apple|huawei|realme|asus|lenovo|lg|smartphone|celular|tablet|tab|smartwatch|notebook|macbook";
const APARELHO_RE = new RegExp(`(^|[^a-z0-9])(${APARELHO})([^a-z0-9]|$)`);
// Aparelhos de telefonia/tablet/relógio (para "capa"/"case", que também existem p/ sofá, chuva, bike…).
const TELEFONIA_RE = /(^|[^a-z0-9])(iphone|ipad|galaxy|samsung|xiaomi|redmi|poco|motorola|moto ?[gez]\d*|apple|huawei|realme|smartphone|celular|tablet|tab|smartwatch|note|fit)([^a-z0-9]|$)/;

// Capa/case/etc. SEM aparelho citado são ambíguos (capa de sofá, de chuva…): só valem com TELEFONIA_RE.
const ACESSORIO_CELULAR_AMBIGUO_RE = /(^|[^a-z0-9])(capas?|capinhas?|cases?)([^a-z0-9]|$)/;
// Inequívocos (não existem para outra coisa): valem sozinhos. `pelicula\w*` cobre "pelicula3d", "peliculas".
const ACESSORIO_CELULAR_RE =
  /(^|[^a-z0-9])(pelicula\w*|hidrogel|protetor(es)? de tela|suporte (de |p\/ |para )?(celular|telefone|smartphone)|skin)([^a-z0-9]|$)/;
// Energia/conexão: plurais (carregadores, adaptadores), "cabo" só com qualificador de conexão.
const ACESSORIO_ENERGIA_RE =
  /(^|[^a-z0-9])(carregador(es)?|adaptador(es)?|power ?banks?|hubs? usb|fontes? (de |p\/ |para )?(alimentacao|energia|carregamento))([^a-z0-9]|$)/;
const CABO_RE = /(^|[^a-z0-9])cabos?([^a-z0-9]|$)/;
const CABO_QUALIFICADOR_RE = /(usb|tipo ?c|type ?c|lightning|hdmi|micro|p2|aux|otg|turbo|dados|carga|carregamento|ethernet|rj45|displayport)/;

const MARCADORES_COMPAT = new Set(["para", "pra", "p", "compativel", "compat"]);
const MODELO_RE = /^(\d|pro|max|plus|ultra|fe|lite|mini|se|x[rs]?|[a-z]\d)/;

/** Remove o ALVO DE COMPATIBILIDADE ("para/p/compatível [com] <aparelho> <modelo…>") do texto normalizado. */
export function semAlvoDeCompatibilidade(t) {
  const toks = t.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const base = toks[i].replace(/[^a-z0-9/]/g, "").replace(/\/$/, "");
    if (MARCADORES_COMPAT.has(base)) {
      // procura um aparelho nos próximos 3 tokens (pula "com", "o", "a", "c/")
      let j = i + 1;
      let achou = -1;
      for (; j < Math.min(toks.length, i + 4); j++) {
        const tk = toks[j].replace(/[^a-z0-9]/g, "");
        if (APARELHO_RE.test(` ${tk} `)) { achou = j; break; }
        if (!["com", "o", "a", "c", "de", "do", "da", "ao"].includes(tk)) break;
      }
      if (achou >= 0) {
        let k = achou + 1;
        while (k < toks.length && k <= achou + 4 && MODELO_RE.test(toks[k].replace(/[^a-z0-9]/g, ""))) k++;
        i = k - 1; // descarta marcador + aparelho + modelo
        continue;
      }
    }
    out.push(toks[i]);
  }
  return out.join(" ");
}

/** Pré-filtro por substantivo de acessório. Retorna o nome da categoria de acessório ou null. */
function acessorioDe(t) {
  if (ACESSORIO_CELULAR_RE.test(t)) return "Acessórios celular/info";
  if (ACESSORIO_CELULAR_AMBIGUO_RE.test(t) && TELEFONIA_RE.test(t)) return "Acessórios celular/info";
  if (ACESSORIO_ENERGIA_RE.test(t)) return "Carregadores/Acessórios eletrônicos";
  if (CABO_RE.test(t) && CABO_QUALIFICADOR_RE.test(t)) return "Carregadores/Acessórios eletrônicos";
  return null;
}

const cacheKw = new Map();
function keywordsDe(cat) {
  if (cacheKw.has(cat)) return cacheKw.get(cat);
  const base = SINONIMOS[cat]
    || norm(cat).split(/[^a-z0-9]+/).filter(Boolean)
        .map((t) => t.replace(/s$/, ""))
        .filter((t) => t.length >= 4 && !STOP.has(t));
  const kws = base.map(norm).filter((k) => k.length >= 3);
  cacheKw.set(cat, kws);
  return kws;
}

// Sugere a melhor categoria para o texto, dentre as disponíveis (keys de params.grupos).
// Retorna o nome exato da categoria ou null.
export function sugerirCategoria(texto, categoriasDisponiveis) {
  const t = norm(texto);
  if (t.length < 3 || !categoriasDisponiveis?.length) return null;
  if (t.includes("a catalogar")) return null; // placeholder de importação

  // 1) Pré-filtro de acessório: tem prioridade sobre o scoring por marca.
  const acc = acessorioDe(t);
  if (acc && categoriasDisponiveis.includes(acc)) return acc;

  // 2) Pontua SEM o alvo de compatibilidade ("para Iphone 15" não vota em Smartphone).
  const tScore = semAlvoDeCompatibilidade(t);

  let best = null;
  let bestScore = 0;
  for (const cat of categoriasDisponiveis) {
    if (cat.startsWith("Diversos")) continue; // é o fallback, não uma sugestão
    let score = 0;
    for (const kw of keywordsDe(cat)) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRe(kw)}(s|es)?([^a-z0-9]|$)`);
      if (re.test(tScore)) score += kw.length + (kw.includes(" ") ? 5 : 0);
    }
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return bestScore > 0 ? best : null;
}
