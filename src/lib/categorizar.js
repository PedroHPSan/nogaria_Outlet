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

  let best = null;
  let bestScore = 0;
  for (const cat of categoriasDisponiveis) {
    if (cat.startsWith("Diversos")) continue; // é o fallback, não uma sugestão
    let score = 0;
    for (const kw of keywordsDe(cat)) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRe(kw)}(s|es)?([^a-z0-9]|$)`);
      if (re.test(t)) score += kw.length + (kw.includes(" ") ? 5 : 0);
    }
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return bestScore > 0 ? best : null;
}
