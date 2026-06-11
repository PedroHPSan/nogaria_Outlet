# Plano — Preparar o NOGÁRIA OUTLET para integrações (Amazon · Mercado Livre · TikTok Shop · Hiper ERP)

> **Princípio:** este trabalho é **aditivo**. Não altera o catálogo, o checklist, a máquina de estados nem os 3.121 itens já carregados. Só acrescenta colunas (todas `nullable`) e telas de captura. Nada do que já funciona é tocado.
>
> **Objetivo:** transformar o sistema na **fonte única e limpa** dos produtos, com todos os dados que as integrações exigem — capturados **na janela presencial da próxima semana**, que é única e irrepetível.

---

## 0. A restrição que manda no plano: throughput, não a lista de campos

São **3.121 itens** (todos em `A_CATALOGAR`), **2 pessoas**, **uma janela de tempo**. O sucesso da visita não é "ter campos bonitos" — é **quantos itens vendáveis saem com dado completo por hora**. Por isso o plano é desenhado de trás pra frente:

1. **Triagem por valor** (a coluna `classe` que já existe): **A+/A/B/C** recebem captura completa; **D/E** podem ir direto para descarte/sucata sem captura cara.
2. **Verificar, não medir do zero:** a planilha-mãe já tem Comp/Larg/Alt/Cubagem/Peso estimados — vamos **pré-carregar** isso no banco para o trabalho de campo virar "confirma/corrige", não "mede com trena".
3. **Nunca travar o fluxo num campo difícil** (ex.: código de barras que não existe). Identidade do produto = **marca + modelo + categoria + fotos** como fallback universal.

---

## 1. Diagnóstico — o que as integrações exigem e o que falta hoje

Legenda: ⭐ = **só dá pra capturar com o produto na mão** (crítico para a visita). 🖥️ = pode ser feito depois, na mesa.

| Dado | ML | Amazon | TikTok | Hiper/NF-e | No banco hoje? | Capturar onde |
|---|:--:|:--:|:--:|:--:|:--:|---|
| Descrição / produto | ✔ | ✔ | ✔ | ✔ | ✅ `produto` | — |
| Preço (min/ideal/sug) | ✔ | ✔ | ✔ | ✔ | ✅ `preco_*` | — |
| Condição (novo/usado/recond.) | ✔ | ✔ | ✔ | — | ⚠️ parcial (`estado`) | 🖥️ derivar |
| Quantidade / estoque | ✔ | ✔ | ✔ | ✔ | ✅ `quantidade` | — |
| **Código de barras (GTIN/EAN)** | ✔* | ✔* | ✔ | ✔* | ❌ | ⭐ escanear |
| **Marca** | ✔ | ✔ | ✔ | — | ❌ | ⭐ |
| **Modelo** | ✔ | △ | △ | — | ❌ | ⭐ |
| **Voltagem (110/220/bivolt)** | ✔ | ✔ | ✔ | — | ❌ | ⭐ (eletro) |
| **Cor** | ✔ | ✔ | ✔ | — | ❌ | ⭐ |
| **Dimensões C×L×A (embalado)** | ✔ | ✔ | ✔ | — | ❌ | ⭐ confirmar |
| **Peso real (kg)** | ✔ | ✔ | ✔ | — | ⚠️ `peso_kg` (estimativa) | ⭐ confirmar |
| **Nº de série / IMEI** | △ | △ | — | — | ❌ | ⭐ (Tier 2) |
| Fotos (múltiplos ângulos) | ✔ | ✔ | ✔ | — | ✅ `fotos` | ⭐ tirar |
| Foto principal fundo branco | △ | ✔ | △ | — | ❌ spec | 🖥️ pós-processar |
| Título otimizado por canal | ✔ | ✔ | ✔ | — | ❌ | 🖥️ |
| NCM | — | — | — | ✔ | ❌ | 🖥️ (volume!) |
| CEST / origem / unidade fiscal | — | — | — | ✔/cond | ❌ | 🖥️ |
| ID do anúncio por canal / status publicação | ✔ | ✔ | ✔ | ✔ | ❌ | 🖥️ (Fase 1) |

`*` GTIN é `required`/`conditional_required` por categoria. Em **lote de leilão usado, boa parte dos itens não terá código de barras legível** (sem caixa, etiqueta gasta, genérico). Por isso ele é capturado **oportunisticamente**, e o fluxo usa marca+modelo+categoria+fotos como identidade — que é exatamente o que alimenta o `EMPTY_GTIN_REASON` do ML e a isenção de GTIN da Amazon.

**Conclusão do diagnóstico:** o sistema hoje **não está preparado**. Faltam ~10 campos, e os marcados ⭐ **não podem ser recuperados depois** sem voltar fisicamente ao storage.

---

## 2. FASE 0 — Entregar ANTES da visita (o que torna a janela proveitosa)

### 2.1 Migração de banco (aditiva, segura)
Acrescentar a `itens` colunas **`nullable`, tipo `text`/`numeric`** (sem novos `enum` — evita a armadilha do valor vazio em enum e mantém a migração trivial):

```
gtin            text       -- código de barras (validar dígito EAN-13 ao escanear)
marca           text
modelo          text
voltagem        text       -- '110V' | '220V' | 'Bivolt' | 'N/A' (lista na UI, não enum)
cor             text
num_serie       text       -- série / IMEI
comprimento_cm  numeric    -- pré-carregado da planilha, confirmar no campo
largura_cm      numeric
altura_cm       numeric
peso_real_kg    numeric    -- pré-carregado (peso_kg) como ponto de partida
ncm             text       -- preenchido depois, na mesa
condicao_anuncio text      -- 'Novo' | 'Usado' | 'Recondicionado' (deriva de estado)
titulo_anuncio  text       -- otimizado depois
descricao_anuncio text
```

> Aditivo: `select *` continua funcionando; o realtime só ganha campos a mais. Zero impacto no que existe.

### 2.2 Pré-carga das dimensões/peso da planilha ⭐ (o passo que salva a visita)
A planilha-mãe (`Catalogo_Itens`) tem **Comp/Larg/Alt/Cubagem/Peso est** por item — dados que nunca entraram no banco. Vamos importá-los para `comprimento_cm/largura_cm/altura_cm/peso_real_kg`. No campo, o trabalho vira **"confirma ou corrige o número que já está na tela"** em vez de medir 3.121 itens do zero (inviável).

### 2.3 Captura na tela `ItemDetail`, em **tiers**
Adicionar um bloco "Dados para venda" no item, organizado por prioridade:

- **Tier 1 — todo item vendável (A/B/C):** botão **escanear código de barras** (com campo manual ao lado), marca, modelo, voltagem, cor, confirmar dimensões/peso, fotos.
- **Tier 2 — alto valor (A+/A):** nº de série/IMEI, ângulos extras de foto, descrição rica.

### 2.4 Scanner de código de barras (novo, com rede de segurança)
- Biblioteca client-side de leitura por câmera (ex.: `@zxing/browser` ou `html5-qrcode`), lendo **EAN-13/UPC**.
- **Sempre com fallback de digitação manual** — o scanner nunca é obrigatório.
- **Validar o dígito verificador** do EAN-13 ao capturar (NF-e NT 2021.003 rejeita GTIN inválido).
- ⚠️ **Risco de estabilidade:** é dependência nova. Entregar de forma isolada e **testar nos celulares reais do Pedro e da Bárbara antes da visita** — descobrir no storage que não funciona no aparelho dela queima a janela.

### 2.5 Orientação de fotos
- Guia rápido na tela (ângulos mínimos: frente, etiqueta/modelo, defeitos, acessórios).
- **Aviso honesto:** as fotos de campo **não** atendem à spec de fundo branco da Amazon. `FOTOGRAFADO` significa "fotografado", não "pronto pra Amazon" — o tratamento de imagem (remoção de fundo) fica para depois.

---

## 3. Operação de campo (roteiro da visita)

1. **Ordenar por `classe` desc** (A+ → E). Investir tempo onde está o dinheiro (o painel "Onde está o dinheiro por classe" já mostra isso).
2. **D/E:** decisão rápida triar vs descarte; sem captura cara.
3. **A/B/C:** fluxo Tier 1 por item: abrir → escanear/marca/modelo → voltagem/cor → confirmar dims/peso pré-carregados → fotos → avançar status.
4. **Sincronização ao vivo** (realtime já ativo) permite os dois trabalharem em paralelo sem conflito.
5. Levar: 2 celulares carregados + power bank, trena, e **testar o scanner e o login de ambos um dia antes**.

---

## 4. FASE 1 — Arquitetura de integração (DEPOIS dos dados; decisão estratégica)

O sistema é a **fonte da verdade**. A publicação nos canais tem dois caminhos:

**Caminho A — Hub de integração (recomendado p/ velocidade):** exportar os produtos limpos para um integrador que já conecta Amazon + ML + TikTok + ERP (ex.: **Bling, Tiny/Olist, Magis5, ANYMARKET**). O hub cuida de publicação multicanal e da NF-e/Hiper. Minimiza desenvolvimento e entrega "ingestão ágil" rápido. **Chave de junção = GTIN** quando existir, senão SKU interno + marca/modelo.

**Caminho B — APIs diretas por canal:** construir adaptadores para ML API, Amazon SP-API, TikTok Shop API. Mais controle, **muito mais trabalho** (cada canal tem atributos por categoria, autenticação OAuth, validações próprias). Justifica-se só se o hub não atender uma regra específica.

**Recomendação:** começar pelo **Caminho A** (exportação CSV/planilha padronizada → hub) e migrar pontos críticos para API direta só se necessário.

**Adequação por canal (importante p/ lote usado):**
- **Mercado Livre** — mercado de usados é forte; **prioridade 1** para o grosso do lote.
- **Amazon** — rígida com usado/lote misto/marca; usar **seletivamente** para itens novos-na-caixa. Avaliar isenção de GTIN por marca+categoria.
- **TikTok Shop** — majoritariamente novos + período de trial com limite diário; bom para itens novos/virais.
- **Hiper ERP** — emissão fiscal/estoque; alimentado pelo mesmo dataset (NCM/unidade/origem).

**Modelo de dados da Fase 1 (quando chegar lá):** nova tabela `publicacoes (sku, canal, listing_id, url, status, publicado_em)` — 1 produto → N canais. Não mexe em `itens`.

---

## 5. Fiscal (tarefa de mesa, sem produto na mão)
NCM, CEST, origem e unidade **não precisam do item físico** — mas **NCM em 3.121 itens de categorias mistas é um trabalho de volume real**. Estratégia: atribuir NCM por **grupo/categoria** (não item a item), começando pelas classes A/B/C. Nomear como tarefa própria, não enterrar no cronograma.

---

## 6. Sequência e riscos

**Antes da visita (Fase 0 — prioridade máxima):**
1. Migração aditiva das colunas. *(rápido)*
2. Pré-carga de dimensões/peso da planilha. *(rápido, alto impacto)*
3. Campos de captura no `ItemDetail` (Tier 1/2).
4. Scanner + fallback manual + **teste nos aparelhos reais**.
5. Guia de fotos.

**Depois (Fase 1):** definir hub vs API, NCM por categoria, tabela `publicacoes`, exportador, publicação multicanal.

**Riscos principais:**
- Scanner falhar no aparelho → mitigado por fallback manual + teste prévio.
- GTIN ausente em boa parte do lote → esperado; identidade por marca/modelo/fotos.
- Fotos fora da spec Amazon → pós-processamento posterior.
- Volume de NCM → atacar por categoria, não item a item.

---

## Anexo — o que NÃO fazer agora
- Não construir as 4 APIs antes de ter os dados.
- Não criar `enum` novo para os atributos (usar `text` + lista na UI).
- Não bloquear captura por GTIN.
- Não tratar `FOTOGRAFADO` como "pronto para Amazon".
