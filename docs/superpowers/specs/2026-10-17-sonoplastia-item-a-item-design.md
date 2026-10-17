# Sonoplastia item a item — design

Data: 2026-10-17 · Estado: aguardando revisão

## Objetivo

A sonoplastia do estúdio deve soar como motion design profissional: **um som para cada item que entra,
sai ou se move na tela**, com tons afinados que formam uma "escadinha" musical, um corpo grave macio
quando um item pousa, deslizes que acompanham o movimento, tiques na digitação e silêncio de verdade
entre os grupos.

### Referência medida

Um vídeo de motion design de 31 s (sem voz e sem música) tem:

- **152 ataques**, ou seja, cerca de **5 por segundo**;
- **tons curtos afinados** (~700 Hz e ~1,5 kHz) que **sobem de nota** quando itens entram em sequência;
- um **"tum" grave** (20–200 Hz) sob cada item que pousa;
- **deslizes de tom** nos movimentos e **tiques** na digitação;
- um **silêncio de ~1,3 s** antes da revelação principal;
- master em **−14 LUFS**.

Hoje o estúdio gera **1 som a cada 1,6–2 s**, escolhido pela análise geral (cortes e picos de movimento),
e por isso soa vazio e genérico.

### Decisões tomadas com o usuário

- O que importa são os **efeitos por item**, não uma música separada. A ideia de usar ElevenLabs Music foi descartada.
- Com voz, os sons ficam **sob a voz**, com o ducking que já existe.
- Cliques, teclas, caneta e papel continuam no **tratamento "quase ASMR"** (commit cfd01ad), em qualquer estilo.

## Visão geral

```
animação ──render leve 15 fps──► detector de eventos ──► eventos [{t, tipo, x, y, área, grupo}]
                                                          │
quadros + resumo dos eventos ──► Claude ──► kit de som (≈8 sons + escala) + momentos grandes (lista atual)
                                                          │
kit ──► ElevenLabs (texturas, 1× por kit) + síntese local (tons e deslizes afinados)
                                                          │
eventos × kit ──► mapeamento por regras ──► faixa "itens" (somada em JS, WAV)
                                                          │
faixa "itens" + momentos grandes + ambiência ──► mixarSonorizacao (já existe) ──► faixa de efeitos
```

## Unidades

### 1. `lib/eventos-visuais.js` — detector (função pura + leitor de quadros)

- `detectarEventos(quadros, { largura, altura, fps })` é uma função **pura**, testável sem ffmpeg.
  - `quadros` é uma lista de `Uint8Array` RGB de uma **grade**: o vídeo reduzido para 48 colunas, e o número de linhas proporcional (cada pixel é uma célula).
  - Devolve `[{ t, tipo: 'entra'|'sai'|'move'|'corte', x, y, area, grupo, dir }]`:
    - `x` e `y` vão de 0 a 1;
    - `area` é a fração da tela;
    - `dir` é `-1 | 0 | 1` no movimento.
- **Fundo:** a cor de fundo de cada célula é a cor que ela tem nos períodos parados (a mediana das cores estáveis).
- **Entrada e saída:** uma célula muda e depois **estabiliza** por ≥ 3 quadros.
  - Se o valor novo está mais longe do fundo do que o antigo, é **entra**; se está mais perto, é **sai**.
  - Células vizinhas (8-conexas) que mudam na mesma janela de ±2 quadros viram **um item**, com bbox, centro e área.
- **Movimento:** uma região ativa por mais de 5 quadros seguidos, com o centro se deslocando, gera **move**.
  - `dir` é o sinal do deslocamento em x.
- **Corte:** mais de 60% das células mudam num quadro. Isso gera **corte**, e os eventos de item desse quadro são suprimidos.
- **Ruído:** ficam de fora os itens com área menor que 2 células, a cintilação ativa por menos de 2 quadros e as regiões que nunca estabilizam (partículas).
- **Grupo (escadinha e cascata):** entradas com intervalo ≤ 0,6 s entre si compartilham o mesmo `grupo`.
  - Um grupo de ≥ 4 entradas pequenas alinhadas na mesma linha (variação de y < 1 célula) é marcado como **digitação**.
- **Leitor:** `quadrosDoVideo(video, { colunas: 48, fps: 15 })` usa ffmpeg (`fps=15,scale=48:-2:flags=area`, `rgb24`) e devolve os quadros.

### 2. Análise (`assistirVideo` em `lib/rotas-audio.js`)

- A prévia leve passa a ser renderizada a **15 fps**; hoje é 10.
- Os `eventos` são calculados **antes** de a prévia ser apagada e gravados em `analise.json`.
- Uma análise em cache **sem** `eventos` é refeita.
- Nas animações por cima do vídeo (fundo transparente), a prévia sai sobre preto, então só os itens da animação contam.

### 3. Kit de som (`lib/sonoplastia-ia.js`)

- O Claude recebe, além do que já recebe, um **resumo dos eventos**: quantos há, a densidade por segundo, os grupos, os maiores itens com o tempo e as digitações.
- Ele devolve, junto com o plano atual (os momentos grandes continuam em `efeitos`), um campo `kit`:

```json
"kit": {
  "escala": { "tonica": "A", "modo": "pentatonica_maior", "oitava": 5 },
  "timbre": "sine | soft_fm | triangle",
  "texturas": {
    "tum": "EN: soft low felt thump ...",
    "saida": "EN: short soft air swish ...",
    "tique": "EN: tiny soft tactile tick ..."
  }
}
```

- Os timbres disponíveis são três:
  - `sine`: seno puro com 2º harmônico a −18 dB;
  - `soft_fm`: seno com modulação FM leve (razão 2, índice que cai junto com o envelope), um "plim" de vidro;
  - `triangle`: onda triangular suavizada com passa-baixa em 6 kHz.
- `modo` aceita: `pentatonica_maior`, `pentatonica_menor`, `maior` ou `dorico`.

- **Texturas:** são pedidas à ElevenLabs uma vez por kit, com cache por descrição.
  - `tum`, `saida` e `tique` passam pelo tratamento "quase ASMR".
  - Uma textura sem som associado (falha ou conta sem permissão) é pulada; o resto continua.
- **Tons e deslizes:** são sintetizados no PC por `lib/sintese-tons.js`, com ffmpeg (`aevalsrc`), na **afinação exata**:
  - envelope com ataque de 3 ms e decaimento exponencial de 120–350 ms;
  - 2º harmônico leve;
  - deslize = varredura de frequência entre duas notas, com 150–400 ms.

  Esse módulo não tem custo de créditos.

### 4. Mapeamento evento → som (`lib/mapa-itens.js`, função pura)

| Evento | Som | Detalhe |
|---|---|---|
| `entra`, área < 2% | tom ("plim") | nota = próximo grau da escala dentro do `grupo` (escadinha); recomeça no grau 0 após 0,6 s sem entradas |
| `entra`, área ≥ 2% | tom uma oitava abaixo + `tum` | volume cresce com a área |
| `entra` em digitação | `tique` por item | ±3% de tom e ±1,5 dB de volume (variação já existente) |
| `sai` | `saida` (swish curto) + tom descendo um grau, baixo | volume 70% da entrada |
| `move` | deslize na direção `dir` | pan acompanha `x` |
| `corte` | não gera som de item | os momentos grandes (Claude) cuidam dos cortes |

Regras gerais:

- **Pan:** `x * 2 − 1`, limitado a ±0,6.
- **Volume:** de 0,22 a 0,45, conforme a área.
- **Densidade máxima:** depende da intensidade escolhida na aba Som — **sutil 2/s**, **equilibrado 3,5/s**, **intenso 5/s**.
  - Acima do limite, os menores eventos saem.
  - Eventos a menos de 60 ms um do outro viram um só, ficando o maior.
- **Respeito aos momentos grandes:** de 0,15 s antes até 0,4 s depois de cada impacto, stinger ou revelação do plano, os sons de item caem para 40% do volume.
- **Respeito aos silêncios:** dentro dos `silencios` do plano, nenhum som de item toca.

### 5. Faixa "itens" (`lib/faixa-itens.js`)

- Cada som do kit, em cada afinação usada, é decodificado **uma vez** para PCM float 48 kHz estéreo.
  - Os tons já saem afinados; as texturas usam `asetrate` só para a variação.
- A faixa é **somada em JavaScript**, aplicando ganho e pan por evento, e gravada como WAV.
  - Assim não há limite de entradas no ffmpeg, mesmo com 150 eventos.
- Ela entra em `mixarSonorizacao` como **um trecho a mais**, começando em 0.
  - Ali já existem a compressão de bus, a ambiência e a loudness.

### 6. Tela (aba Som)

- Uma linha nova: **"✓ Som em cada item que entra/sai"**.
  - Ela aparece e vem ligada por padrão **só com a fonte ElevenLabs**. Na síntese por código e na biblioteca, o fluxo atual não muda.
  - Ela mostra "N sons de item · X por segundo".
- O **kit** aparece como uma fileira de chips, com ▶ para ouvir cada som. ↻ troca a variação de uma textura.
- A lista atual de momentos grandes continua igual.

### 7. Master do MP4 final

- `aplicarAudioNoVideo` ganha uma normalização final **linear em duas passadas** para **−14 LUFS** (o volume de Reels e TikTok, igual à referência), com limitador em −1 dBTP.
- Só ganho fixo, sem compressão extra.

## Erros e limites

- **Nenhum evento detectado** (por exemplo, uma animação abstrata contínua): a sonoplastia sai como hoje, só com os momentos grandes, e a aba Som avisa "nenhum item detectado".
- **Falha da ElevenLabs numa textura:** o kit funciona só com os tons sintetizados, que não dependem de crédito.
- **Assinatura da sonoplastia:** inclui o kit e um hash dos eventos, então uma nova versão da animação deixa o som "pendente".

## Testes

- **Detector, com quadros sintéticos:**
  - um quadrado que aparece no quadro 10 → 1 `entra` em t ≈ 0,67 s (15 fps), na posição certa;
  - o quadrado que some → 1 `sai`;
  - o quadrado que anda → `move` com `dir` certo;
  - 6 quadradinhos aparecendo em linha a cada 0,15 s → mesmo `grupo` e marcados como digitação;
  - troca da tela inteira → `corte`, sem eventos de item;
  - ruído de 1 célula cintilando → nenhum evento.
- **Mapeamento:**
  - a escadinha sobe os graus da escala e recomeça após 0,6 s;
  - o limite de densidade é respeitado;
  - eventos a menos de 60 ms se fundem;
  - os sons de item são abaixados nos momentos grandes e silenciados nos silêncios.
- **Síntese:** um tom de A5 (880 Hz) tem a frequência dominante dentro de ±1%; o deslize começa e termina nas notas certas.
- **Faixa:** a soma de 3 eventos sai na duração certa, com pico no tempo certo e o pan aplicado.
- **Real:**
  - o projeto do usuário com a animação atual;
  - contagem de sons por segundo, que deve se aproximar da densidade escolhida;
  - um antes × depois em MP3 para ouvir;
  - o MP4 final medido em −14 LUFS ± 1.

## Fora do escopo

- Música de fundo.
- Instrumentar o DOM da animação; o detector por imagem cobre DOM e canvas.
- Editar o som de cada evento individualmente na tela.
- Mudanças no Editor.
