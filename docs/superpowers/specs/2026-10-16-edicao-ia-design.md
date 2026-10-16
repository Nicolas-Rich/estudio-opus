# Edição IA — o estúdio edita os vídeos que você gravou falando

Data: 2026-10-16 · Status: aguardando revisão

## 1. Objetivo

A pessoa envia um ou mais vídeos dela falando para a câmera (vertical, até ~60 s no total). O estúdio:

1. emenda os vídeos **na ordem que a pessoa definiu**;
2. corta pausas, vícios de fala e frases repetidas ou erradas;
3. cria, com liberdade criativa, **elementos animados** sincronizados com o que é dito (textos, 3D, ícones, gráficos, telas explicativas…);
4. mexe na imagem da pessoa (zoom de ênfase, encolher para um canto ou meia tela, deslocar para o lado);
5. entrega tudo montado no **Editor**, em camadas editáveis, com legendas automáticas.

**Sucesso:** um vídeo de 60 s sai editado, com cortes limpos e elementos no tempo da fala (±0,15 s), sem tela preta, e cada elemento pode ser movido, apagado ou refeito sozinho no Editor.

### O que a pessoa pediu (decisões)
- Vários vídeos viram **um** vídeo final, **na sequência enviada** (o estúdio não reordena nem escolhe takes entre vídeos).
- Abordagem A: **camadas por cima** do vídeo (não uma animação única com o vídeo dentro).
- **Liberdade criativa total**: sem regras de estilo. Só dois cuidados técnicos: nada importante embaixo dos botões do Reels, e texto legível no celular.
- Pode mexer na imagem da pessoa (arrastar, encolher, zoom).
- Elementos **presos ao corpo** (ex.: "bola na minha mão girando") — fase 2.
- Fluxo padrão: **revisar o plano antes de gerar**; opção "Fazer tudo automático".

### Suposições
- Formato final 9:16, 1080×1920, 30 fps.
- Vídeos de entrada em qualquer proporção: são ajustados por *cobrir* (corte central), como o Editor faz hoje.
- Áudio da pessoa é a única voz; a música pode ser adicionada depois no Editor.

## 2. Fases

| Fase | Entrega |
|---|---|
| **1** | Envio de vários vídeos, emenda, transcrição, cortes, plano, revisão, elementos soltos e de tela cheia (render com transparência), movimentos da imagem, camada "Elementos" no Editor, exportação |
| **2** | Rastreamento do corpo (MediaPipe) e elementos presos à mão, rosto, cabeça e ombros |
| **3** | Elementos que passam por trás da pessoa (recorte do corpo) |

Esta especificação detalha a fase 1 e define os formatos que a fase 2 usa. A fase 3 fica só registrada.

## 3. Arquitetura

```
Aba ✂ Edição IA (public/edicao-ia.js)
   │  enviar vídeos, ordenar, briefing → revisar plano → gerar → abrir no Editor
   ▼
lib/rotas-edicao-ia.js  (rotas + jobs + estado em disco)
   ├─ lib/edicao-ia/preparar.js   normaliza, emenda, transcreve, silêncios, quadros
   ├─ lib/edicao-ia/cortes.js     candidatos a corte (puro, testável)
   ├─ lib/edicao-ia/plano.js      pede o plano ao Claude e valida (validação pura, testável)
   ├─ lib/edicao-ia/elementos.js  gera o HTML de cada elemento e renderiza com transparência
   ├─ lib/edicao-ia/montar.js     plano + elementos → linha do tempo do Editor (puro, testável)
   └─ lib/edicao-ia/rastreio.js   (fase 2) MediaPipe → rastreio.json
Reaproveita: transcricao.js, analise-video.js, claude.js (perguntarClaude/gerarComClaude),
checar-html.js, render.js (+ modo transparente), montagem.js (+ sobreposições e movimentos)
```

Cada unidade tem uma tarefa e uma interface pequena; as partes de cálculo (`cortes`, validação do `plano`, `montar`, expressões de movimento) não tocam disco nem rede e têm testes.

## 4. Dados em disco

`dados/edicoes-ia/<id>/` (dentro de `dados/`, que nunca vai para o GitHub):

| Arquivo | Conteúdo |
|---|---|
| `estado.json` | id, nome, briefing, ordem dos vídeos, etapa, automático, status de cada elemento, erros |
| `fontes/NN.mp4` | cada vídeo enviado, normalizado (1080×1920, 30 fps, yuv420p, AAC 48 kHz) |
| `base.mp4` | os vídeos emendados na ordem; a **linha do tempo base** (tempos do plano usam esta) |
| `segmentos.json` | `[{ fonte: 'NN.mp4', inicio, fim }]` — onde cada vídeo começa e termina na base |
| `transcricao.json` | palavras com tempo (`{ p, inicio, fim }`) e frases, vindas de `transcricao.js` |
| `silencios.json` | `[{ inicio, fim }]` do `silencedetect` (−35 dB, ≥ 0,4 s) |
| `quadros/` | folhas de quadros com tempo (de `analise-video.js`) para o Claude ver o enquadramento |
| `plano.json` | o plano validado (seção 6) |
| `elementos/<elId>/v<n>.html` e `render.mov` | cada elemento, suas versões e o vídeo com transparência |
| `rastreio.json` | (fase 2) seção 10 |

Etapas de `estado.etapa`: `enviado → preparado → planejado → gerando → pronto`, e `erro` com a mensagem. Cada etapa grava o estado ao terminar; reabrir a aba continua de onde parou.

## 5. Preparação (sem Claude)

1. **Normalizar** cada vídeo enviado com ffmpeg (`scale…increase,crop=1080:1920,fps=30`, áudio AAC 48 kHz estéreo). Vídeo sem áudio recebe silêncio.
2. **Emendar** com o *concat demuxer* na ordem do `estado.ordem` → `base.mp4`; gravar `segmentos.json`.
3. **Transcrever** `base.mp4` com `transcricao.js` (Whisper local, palavras com tempo, idioma pt).
4. **Silêncios** com `silencedetect=n=-35dB:d=0.4`.
5. **Quadros**: `analise-video.js` gera as folhas com tempo.
6. **Candidatos a corte** (`cortes.js`, puro): silêncios encurtados para deixar 0,12 s de respiro de cada lado; vícios isolados (`é`, `éé`, `hã`, `hum`, `tipo`, `né`, `então` quando seguido de pausa) marcados como candidatos. O Claude decide os cortes finais no plano (inclusive frases repetidas: fica a última versão).

## 6. Plano (uma chamada ao Claude)

**Entrada do pedido:** briefing; transcrição com tempo (palavras agrupadas por frase); candidatos a corte; `segmentos` (para saber onde cada vídeo começa); folhas de quadros (imagens); duração da base; dimensões 1080×1920; zonas técnicas (barra inferior 0–22 % de baixo e coluna direita 82–100 % ficam livres de texto importante). Tom do pedido: **liberdade criativa total**, prender a atenção, qualidade de edição profissional, surpresas visuais.

**Saída (JSON):**

```json
{
  "estilo": { "paleta": ["#0b0b10", "#7c5cff", "#ffffff"], "fonte": "Inter", "clima": "tech escuro com brilho roxo" },
  "manter": [ { "inicio": 0.42, "fim": 6.10 }, { "inicio": 6.85, "fim": 14.20 } ],
  "movimentos": [
    { "inicio": 3.1, "fim": 3.9, "tipo": "zoom", "escala": 1.25 },
    { "inicio": 9.0, "fim": 13.5, "tipo": "canto", "canto": "inferior-esquerdo", "escala": 0.38 }
  ],
  "elementos": [
    {
      "id": "e1", "inicio": 9.0, "fim": 13.5, "camada": "tela-cheia",
      "regiao": null, "ancora": null,
      "descricao": "Gráfico de barras 3D subindo de 20% para 80% enquanto ela fala 'quatro vezes mais'",
      "textoNaTela": "4× MAIS"
    },
    {
      "id": "e2", "inicio": 2.8, "fim": 4.4, "camada": "sobre",
      "regiao": { "x": 8, "y": 10, "w": 84, "h": 22 }, "ancora": null,
      "descricao": "Palavra ATENÇÃO explodindo em partículas", "textoNaTela": "ATENÇÃO"
    }
  ]
}
```

- Tempos em segundos **na linha do tempo base** (antes dos cortes).
- `camada`: `sobre` (por cima da pessoa, numa `regiao` em % da tela) ou `tela-cheia` (cobre tudo; a pessoa pode estar num `canto` via movimento).
- `movimentos.tipo`: `zoom` (`escala`), `canto` (`canto`, `escala`), `meia` (`lado`: superior/inferior), `lado` (`direcao`, `deslocamento` em %), `cheia` (volta ao normal). Entre movimentos a transição é suave (0,35 s, ease-in-out).
- `ancora` (fase 2): `mao-direita`, `mao-esquerda`, `rosto`, `cabeca`, `ombros`, ou `null`.

**Validação** (`plano.js`, pura): JSON parseável; `manter` ordenado, sem sobreposição, dentro de `[0, duração]`, trechos ≥ 0,3 s, e soma ≥ 30 % da base; movimentos e elementos dentro da duração, `fim > inicio`, tipos conhecidos, `regiao` dentro de 0–100; ids únicos; até 25 elementos. Erros consertáveis são corrigidos (cortar ao limite, descartar item inválido com aviso); se o JSON não parsear ou `manter` ficar vazio, **pede de novo uma vez** com a mensagem do erro; se falhar de novo, a etapa vira `erro`.

## 7. Revisão do plano (aba)

- Linha do tempo com a transcrição; trechos cortados aparecem riscados; cada elemento é um card no seu tempo (descrição, texto na tela, camada).
- A pessoa pode: apagar elemento; editar descrição/texto; mudar início/fim; desfazer um corte (clicar no trecho riscado); pedir **"Refazer o plano"** com uma instrução.
- Botão **Gerar elementos**. No modo automático esta tela é pulada.

## 8. Elementos (uma chamada ao Claude por elemento)

**Pedido**: estilo do plano + descrição + texto na tela + duração (`fim − inicio`) + tamanho do palco (`regiao` em pixels, ou 1080×1920 em `tela-cheia` e em elementos ancorados) + o trecho falado naquele momento (com os tempos das palavras **relativos ao início do elemento**, para sincronizar dentro dele).

**Regras técnicas** (as únicas): fundo **transparente** (`html, body { background: transparent }`) em `sobre`; fundo próprio em `tela-cheia`; animação dirigida por tempo e que começa sozinha (igual às animações do estúdio); entra e sai com animação própria; pode usar three.js/GSAP do CDN como hoje; JavaScript válido.

**Pipeline por elemento**: gerar → `consertarHtml` (checar-html.js) → se sobrar erro de sintaxe, pedir correção ao Claude **uma vez** → render com transparência → `render.mov` (exportação) + `preview.webm` (VP9 `yuva420p`, prévia no Editor). Status por elemento: `fila`, `gerando`, `renderizando`, `pronto`, `erro`.

**Render com transparência** (`render.js`, nova opção `transparente: true`): `Emulation.setDefaultBackgroundColorOverride` com alfa 0, captura em PNG, codifica `-c:v png -pix_fmt rgba` em `.mov` (clipes curtos; tamanho aceitável). Sem a opção, o render continua exatamente como hoje.

**Fila**: um elemento por vez no Claude; renders na fila pesada que já existe (`naFila`). Se a resposta do Claude indicar limite de uso (`/limit|usage limit|weekly/i`), a fila **pausa**, os elementos prontos ficam, e a aba mostra "Limite do Claude atingido — Continuar" para retomar.

## 9. Montagem no Editor

`montar.js` (puro) transforma `plano + elementos prontos` numa edição do Editor (`edicao.json`):

- **Cortes = clipes**: cada trecho de `manter` vira um clipe `{ tipo: 'video', arquivo: base.mp4, inicio, fim }` na trilha principal, em ordem, corte seco. Mapa `base → editado` calculado para converter os tempos.
- **Movimentos** viram `movimento: [{ t, escala, x, y }]` (quadros-chave relativos ao clipe, coordenadas em % do centro). Um movimento que atravessa um corte é dividido entre os clipes.
- **Elementos** viram a nova lista `sobreposicoes: [{ uid, elId, arquivo: render.mov, inicio, fim, x, y, w, h }]` em tempos **editados**; elemento que cai inteiro num trecho cortado é descartado; o que atravessa um corte é encurtado.
- **Legendas**: ligadas (`legendas.ativo = true`), geradas como hoje pela transcrição do áudio final.
- A edição atual do Editor é **guardada** (cópia em `dados/edicao-anterior-<data>.json`) antes de ser substituída, e a aba avisa.

**Exportação** (`montagem.js`):
- Clipe com `movimento`: o fundo atrás da pessoa encolhida segue `tl.fundoMovimento`: `desfoque` (padrão: o próprio clipe *cobrir* + `boxblur`) ou `cor` (a cor 1 da paleta, gravada em `tl.corFundo`). A pessoa vai por cima com `scale=…:eval=frame` e `overlay` cujas posições são expressões por partes (`if(between(t,a,b),…)`) com ease-in-out. Sem `movimento`, o clipe sai como hoje.
- `sobreposicoes`: cada `render.mov` entra com `setpts=PTS-STARTPTS+<inicio>/TB` e `overlay=x:y:enable='between(t,inicio,fim)':format=auto`, depois das transições e antes das legendas. Edições sem `sobreposicoes` exportam exatamente como hoje.

**Editor (UI)**: nova faixa **Elementos** entre o vídeo e os textos; cada sobreposição é um bloco que pode ser arrastado no tempo, apagado, ou **Refazer** (pede ao Claude uma nova versão com uma instrução, re-renderiza e troca o arquivo). O painel do clipe mostra os movimentos e permite removê-los. A pré-visualização do Editor mostra o `preview.webm` de cada elemento (com transparência) num `<video>` posicionado por cima do vídeo e sincronizado com o cabeçote; a exportação usa o `render.mov` (ver risco R2).

## 10. Rastreamento do corpo (fase 2)

`rastreio.js` roda um script Python com MediaPipe via `uvx` (mesmo modelo de dependência do Whisper) sobre `base.mp4` a 15 fps e grava:

```json
{ "fps": 15, "quadros": [ { "t": 0.0,
  "maoDireita": { "x": 0.62, "y": 0.71, "ok": true },
  "maoEsquerda": { "x": 0.31, "y": 0.69, "ok": false },
  "rosto": { "x": 0.5, "y": 0.33, "tamanho": 0.21, "ok": true },
  "ombros": { "x": 0.5, "y": 0.48, "largura": 0.42, "ok": true } } ] }
```

Coordenadas normalizadas (0–1) na base; suavização (média móvel de 5 quadros); buracos curtos (< 0,5 s) interpolados. O Claude recebe um resumo (onde as mãos aparecem e quando estão visíveis) para decidir as âncoras. Um elemento ancorado é gerado em palco 1080×1920 e recebe `window.__ANCORA__ = [{ t, x, y, escala, ok }]` em pixels, já convertido para os tempos do elemento e para o enquadramento (inclusive se houver `movimento` naquele trecho). Quando `ok` vira falso, o elemento solta suavemente ou fica no último ponto.

## 11. Erros e recuperação

| Situação | Comportamento |
|---|---|
| Vídeo enviado inválido / sem vídeo | recusado no envio, com mensagem |
| Whisper/uv ausente | etapa `erro` com a instrução de instalar o uv (mensagem que já existe) |
| Plano inválido | uma nova tentativa automática; depois `erro` com "Refazer o plano" |
| Elemento com erro de JS | conserto automático; senão uma correção pelo Claude; senão o card fica vermelho com "Tentar de novo" |
| Limite do Claude | fila pausa, prontos ficam, botão "Continuar" |
| Estúdio fechado no meio | ao abrir, etapas em andamento voltam para o último estado salvo; elementos `gerando` voltam para `fila` |
| Montagem sem nenhum elemento pronto | monta só os cortes e movimentos, com aviso |

## 12. Testes

Primeiros testes do repositório, com `node --test` (script `npm test`), em `test/`:

- `cortes.test.js`: silêncios viram cortes com respiro; vícios isolados; nada é cortado no meio de uma palavra.
- `plano.test.js`: JSON válido passa; tempos fora da duração são cortados; sobreposição em `manter` é resolvida; `manter` vazio falha.
- `montar.test.js`: mapa base→editado; elemento dentro de trecho cortado é descartado; elemento que atravessa corte é encurtado; movimento dividido entre clipes.
- `montagem.test.js`: a expressão de movimento por partes; o grafo de filtros com sobreposições contém os `overlay` com `enable` certos; sem `sobreposicoes` o grafo é igual ao de hoje.
- `checar-html.test.js`: os casos já verificados à mão (sinal antes de potência).

Ponta a ponta (manual): um vídeo de ~15 s da pessoa falando e mostrando a mão, enviado em **dois arquivos**; conferir ordem, cortes, sincronia, transparência e exportação; e, na fase 2, a bola na mão.

## 13. Riscos

- **R1 — Custo e tempo do Claude:** ~1 plano + 8–12 elementos curtos por vídeo de 60 s. Medir no primeiro teste e mostrar na aba.
- **R2 — Pré-visualização no Editor:** o Chrome não toca `.mov` com PNG. Para a prévia, cada elemento também gera um `preview.webm` (VP9 com alfa, `yuva420p`), que o Chrome toca com transparência; a exportação usa o `.mov`.
- **R3 — Expressões de movimento no ffmpeg** podem ficar lentas com muitos quadros-chave; limite de 12 movimentos por vídeo.
- **R4 — Rastreamento (fase 2)** falha com mão fora do quadro ou movimento rápido; mitigado com suavização, interpolação e soltura suave.
- **R5 — Plano criativo demais**: sem regras de estilo, pode poluir. A pessoa revisa o plano antes (padrão) e pode apagar elementos.

## 14. Fora do escopo

Música automática, vozes geradas, reordenar takes entre vídeos, formatos além de 9:16, vídeos longos (> 3 min), fase 3.
