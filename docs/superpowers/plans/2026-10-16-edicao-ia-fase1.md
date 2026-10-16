# Edição IA — Fase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pessoa envia um ou mais vídeos falando; o estúdio emenda na ordem, corta, pede um plano criativo ao Claude, gera elementos animados com transparência e entrega tudo em camadas no Editor.

**Architecture:** módulos puros e testáveis em `lib/edicao-ia/` (cortes, plano, montar) e `lib/` (movimento, sobreposicoes); módulos com efeito (preparar, elementos, render transparente) reaproveitam ffmpeg/Whisper/Claude/Playwright que já existem; `lib/rotas-edicao-ia.js` orquestra com estado em `dados/edicoes-ia/<id>/estado.json`; UI numa seção nova do `public/app.js` (o arquivo é um módulo ES isolado, então a aba fica nele, como Cenas IA e Opus Generator).

**Tech Stack:** Node ≥ 20 (ESM), Express 5, ffmpeg-static (libvpx-vp9, png, overlay, silencedetect disponíveis), playwright-core, Claude CLI (`perguntarClaude`/`gerarComClaude`), Whisper via `uvx` (`transcrever`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-16-edicao-ia-design.md`

## Global Constraints

- Sem dependências npm novas. Testes com `node --test` (script `"test": "node --test test/"`).
- Toda a UI e mensagens em português do Brasil.
- `dados/` nunca vai para o git. Antes de cada push: nenhuma chave (ElevenLabs/Kie) no índice, nada de `dados/`, `node_modules/`, `awesome-opus5-5-videos/`; nenhuma referência pessoal ou de marca.
- Formato de saída: 1080×1920, 30 fps, yuv420p, AAC 48 kHz estéreo.
- Silêncio: `silencedetect=n=-35dB:d=0.4`; respiro de 0,12 s de cada lado do corte.
- Vícios candidatos: `é`, `éé`, `hã`, `hum`, `tipo`, `né`, `então` (este só quando seguido de pausa ≥ 0,3 s).
- Zonas técnicas: faixa inferior 0–22 % (de baixo) e coluna direita 82–100 % sem texto importante.
- Sincronia alvo: ±0,15 s. Transição de movimento: 0,35 s ease-in-out.
- Limites do plano: até 25 elementos, até 12 movimentos, trechos `manter` ≥ 0,3 s, soma de `manter` ≥ 30 % da base. Uma nova tentativa automática do plano.
- Limite do Claude detectado por `/limit|usage limit|weekly/i` na mensagem de erro → fila pausa.
- Caminhos do usuário têm espaço e acento (ex.: `C:\Users\...\A2 SYSTEM\...`): todo caminho passado ao ffmpeg em lista de concat ou filtro passa por escape.

## Review Focus

1. **Vídeos de proporção, fps ou rotação diferentes** (celular com metadado de rotação, um take horizontal): devem sair 1080×1920 sem esticar (cobrir + corte central). Teste em Task 7.
2. **Vídeo sem faixa de áudio** (gravação de tela, câmera sem microfone): a emenda não pode dessincronizar nem falhar; recebe silêncio. Teste em Task 7.
3. **Caminho com espaço, acento ou apóstrofo** na lista do concat e nos filtros: não pode quebrar o ffmpeg. Teste em Task 7.
4. **Elemento cujo início cai num trecho cortado**: é descartado antes de gastar Claude; o que atravessa um corte é encurtado ao trecho onde começa. Teste em Task 2.
5. **Exportar depois que a pessoa mexeu no Editor** e uma sobreposição aponta para um arquivo que não existe mais: a exportação ignora essa sobreposição em vez de falhar. Teste em Task 5.

---

### Task 1: Infra de testes e candidatos a corte

**Files:**
- Modify: `package.json` (script `test`)
- Create: `lib/edicao-ia/cortes.js`
- Test: `test/cortes.test.js`, `test/checar-html.test.js`

**Interfaces:**
- Produces: `candidatosDeCorte({ palavras, silencios, duracao }) -> Array<{ inicio:number, fim:number, motivo:'silencio'|'vicio' }>` (ordenado, sem sobreposição). `palavras` = `[{ p, inicio, fim }]` (formato de `transcrever`), `silencios` = `[{ inicio, fim }]`.

- [ ] **Step 1: Write the failing tests**

```js
// test/cortes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatosDeCorte } from '../lib/edicao-ia/cortes.js';

test('silêncio vira corte com 0,12 s de respiro de cada lado', () => {
  const r = candidatosDeCorte({ palavras: [{ p: 'oi', inicio: 0, fim: 1 }, { p: 'gente', inicio: 2.5, fim: 3 }], silencios: [{ inicio: 1, fim: 2.5 }], duracao: 3 });
  assert.deepEqual(r, [{ inicio: 1.12, fim: 2.38, motivo: 'silencio' }]);
});
test('silêncio menor que 0,4 s depois do respiro não vira corte', () => {
  assert.deepEqual(candidatosDeCorte({ palavras: [], silencios: [{ inicio: 1, fim: 1.5 }], duracao: 3 }), []);
});
test('vício isolado vira corte; "então" só quando seguido de pausa', () => {
  const palavras = [{ p: 'Olha', inicio: 0, fim: 0.4 }, { p: 'é…', inicio: 0.5, fim: 0.9 }, { p: 'então', inicio: 1.0, fim: 1.3 }, { p: 'vamos', inicio: 1.35, fim: 1.7 }];
  const r = candidatosDeCorte({ palavras, silencios: [], duracao: 2 });
  assert.equal(r.length, 1);
  assert.equal(r[0].motivo, 'vicio');
  assert.ok(r[0].inicio >= 0.4 && r[0].fim <= 1.0);
});
test('nunca corta no meio de uma palavra', () => {
  const r = candidatosDeCorte({ palavras: [{ p: 'longa', inicio: 0.9, fim: 1.6 }], silencios: [{ inicio: 0.2, fim: 1.2 }], duracao: 2 });
  for (const c of r) assert.ok(c.fim <= 0.9);
});
```

```js
// test/checar-html.test.js — casos já verificados à mão
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consertarHtml } from '../lib/checar-html.js';
const s = (js) => `<script>${js}</script>`;
test('conserta sinal antes de potência', () => {
  const r = consertarHtml(s('const a=Math.exp(-((t-1)/.2)**2);'));
  assert.equal(r.trocas, 1); assert.equal(r.erros.length, 0);
  assert.match(r.html, /-\(\(\(t-1\)\/\.2\)\*\*2\)/);
});
test('não mexe em subtração binária nem em código válido', () => {
  for (const js of ['const b=x-((t-1)/2)**2;', 'const ok=Math.exp(-(((t-1)/.2)**2));']) assert.equal(consertarHtml(s(js)).trocas, 0);
});
```

- [ ] **Step 2:** `npm test` → FAIL (`Cannot find module .../cortes.js`); `checar-html.test.js` já passa.
- [ ] **Step 3: Implement `candidatosDeCorte`** em `lib/edicao-ia/cortes.js`. Silêncios: encolher 0,12 s de cada lado, depois recortar para não invadir nenhuma palavra; descartar se sobrar < 0,4 s. Vícios: palavra normalizada (minúsculas, sem pontuação/reticências) na lista dos Global Constraints, isolada (pausa ≥ 0,15 s antes ou depois); `então` exige pausa ≥ 0,3 s depois. Juntar intervalos que se tocam; ordenar.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add package.json lib/edicao-ia/cortes.js test/` · `git commit -m "Edição IA: testes e candidatos a corte"`

---

### Task 2: Plano — pedido, validação e chamada ao Claude

**Files:**
- Create: `lib/edicao-ia/plano.js`
- Test: `test/plano.test.js`

**Interfaces:**
- Consumes: `perguntarClaude({ sistema, pedido, modelo, pastaImagens, aoProgresso, sinal }) -> { texto, custo }` (`lib/claude.js`); `linhaDoTempoDaFala(transcricao)` (`lib/transcricao.js`).
- Produces:
  - `validarPlano(bruto: object, { duracao: number }) -> { plano, avisos: string[] }` — lança `Error` se `manter` ficar vazio ou a soma < 30 %.
  - `extrairJson(texto: string) -> object` — pega o primeiro bloco ```json``` ou o maior `{…}`; lança se não parsear.
  - `montarPedidoPlano({ transcricao, candidatos, segmentos, duracao, briefing, folhas: string[] }) -> string`
  - `pedirPlano({ ...entradaDoPedido, pastaQuadros, modelo, aoProgresso, sinal }) -> { plano, avisos, custo }` — 1 tentativa extra com a mensagem do erro anexada ao pedido.
  - Formato de `plano` = seção 6 da spec (`estilo`, `manter`, `movimentos`, `elementos`).

- [ ] **Step 1: Write the failing tests** (`test/plano.test.js`)
  - `plano válido passa intacto`: um plano com 2 trechos, 1 zoom, 1 elemento `sobre` → `avisos` vazio, igual à entrada.
  - `tempos fora da duração são cortados`: `manter: [{inicio:-1, fim: 50}]`, `duracao: 30` → `[{inicio:0, fim:30}]` e 1 aviso.
  - `trechos sobrepostos em manter são unidos`: `[{0,5},{4,8}]` → `[{0,8}]`.
  - `manter vazio lança`: `assert.throws(() => validarPlano({ manter: [] }, { duracao: 10 }), /manter/)`.
  - `soma < 30 % lança`: `manter: [{0,2}]`, `duracao: 10` → throws.
  - `elemento que começa num trecho cortado é descartado` (Review Focus 4): `manter [{0,5},{8,10}]`, elemento `{inicio:6, fim:9}` → removido, aviso contém o id.
  - `elemento que atravessa um corte é encurtado ao trecho onde começa`: elemento `{inicio:4, fim:9}` → `{inicio:4, fim:5}`.
  - `tipos desconhecidos e regiao fora de 0–100 são descartados/limitados`; `ids repetidos ganham sufixo`; `mais de 25 elementos ou 12 movimentos são cortados` (mantém os primeiros por tempo).
  - `extrairJson aceita bloco cercado e texto com lixo em volta`.
- [ ] **Step 2:** `npm test` → FAIL (módulo inexistente).
- [ ] **Step 3: Implement** `validarPlano`, `extrairJson`, `montarPedidoPlano`, `pedirPlano` em `lib/edicao-ia/plano.js`. O sistema do pedido diz: editor de vídeo de alto nível, **liberdade criativa total**, prender a atenção, surpresas visuais; responder **só JSON** no formato da spec seção 6; tempos na base; elementos devem caber dentro de um trecho `manter`; respeitar só as zonas técnicas dos Global Constraints; as folhas de quadros estão em `pastaQuadros` (ler com Read). `estilo` ausente recebe padrão `{ paleta: ['#0b0b10','#7c5cff','#ffffff'], fonte: 'Inter', clima: '' }`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Edição IA: plano (pedido, validação, Claude)"`

---

### Task 3: Montar a edição do Editor a partir do plano

**Files:**
- Create: `lib/edicao-ia/montar.js`
- Test: `test/montar.test.js`

**Interfaces:**
- Consumes: `plano` validado (Task 2).
- Produces:
  - `mapaTempo(manter) -> { paraEditado(tBase): number|null, total: number }`
  - `estadoDaImagem(movimentos, tBase) -> { escala, x, y }` — x/y = centro da imagem da pessoa em % da tela (50/50 = normal); `zoom` → `{escala, 50, 50}`; `canto` com margem 4 % (ex.: inferior-esquerdo `x = 4 + 50·e`, `y = 96 − 50·e`); `meia` → `{0.5, 50, 25|75}`; `lado` → `{1, 50 ± deslocamento, 50}`; `cheia`/fora de movimento → `{1, 50, 50}`; ease-in-out de 0,35 s na entrada e na saída.
  - `montarEdicao({ plano, midiaBase: string, edicaoId: string, elementosProntos: Array<{ elId, versao }> }) -> edicao` no formato do `edicao.json` do Editor: `{ nome, formato:'9:16', fps:30, encaixe:'cobrir', fundoMovimento:'desfoque', corFundo, clipes, textos:[], audios:[], legendas:{ ativo:true, …legendasPadrão }, sobreposicoes }`.
  - Clipe: `{ uid, tipo:'video', midia: midiaBase, inicio, fim, velocidade:1, volume:1, transicao:{tipo:'nenhuma',dur:0.5}, filtro:{preset:'',brilho:0,contraste:1,saturacao:1}, movimento: [{ t, escala, x, y }] }` (`t` relativo ao clipe; amostras nas bordas do clipe e a cada 0,0875 s dentro das rampas; `movimento` omitido se a imagem fica normal o clipe todo).
  - Sobreposição: `{ uid, edicaoId, elId, versao, inicio, fim, x, y, w, h }` em **segundos editados** e **pixels** de 1080×1920 (`tela-cheia` e ancorado → `0,0,1080,1920`).

- [ ] **Step 1: Write the failing tests** (`test/montar.test.js`)
  - `mapaTempo`: `manter [{1,3},{5,6}]` → `paraEditado(1)=0`, `(2.5)=1.5`, `(5.5)=2.5`, `(4)=null`, `total=3`.
  - `cada trecho manter vira um clipe com midia base`: 2 trechos → 2 clipes com `inicio/fim` iguais aos trechos.
  - `movimento dividido entre clipes`: um `canto` de 2 s a 6 s com `manter [{0,4},{4.5,8}]` → os dois clipes têm `movimento`, o 1º termina em escala do canto, o 2º começa nela.
  - `sem movimentos não há campo movimento`.
  - `sobreposição em pixels e tempo editado`: elemento `sobre` com `regiao {x:10,y:10,w:80,h:20}` em base 5,5–6 com `manter [{1,3},{5,6}]` → `{ inicio: 2.5, fim: 3, x:108, y:192, w:864, h:384 }`.
  - `só entram elementos prontos` (passa `elementosProntos` sem o e2 → só e1).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement** em `lib/edicao-ia/montar.js` (puro: sem disco, sem rede).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Edição IA: montar a edição a partir do plano"`

---

### Task 4: Movimento da imagem na exportação

**Files:**
- Create: `lib/movimento.js`
- Modify: `lib/montagem.js` (cadeia de vídeo de cada clipe, perto das linhas 106–129)
- Test: `test/movimento.test.js`

**Interfaces:**
- Consumes: `clipe.movimento` (Task 3), `tl.fundoMovimento`, `tl.corFundo`.
- Produces:
  - `exprPorPartes(quadros: Array<{t:number, v:number}>) -> string` — expressão ffmpeg linear por partes em `t`, ex.: `if(lt(t,0.35),1+(0.38-1)*(t-0)/0.35,0.38)`; um quadro só → constante.
  - `filtroMovimento({ entrada:'[x]', saida:'[y]', movimento, W, H, fundo:'desfoque'|'cor', cor }) -> string[]` — `split` → fundo (`boxblur=20:2` sobre a cópia, ou `color=c=<cor>:s=WxH`) + pessoa `scale=w='W*e(t)':h='H*e(t)':eval=frame` + `overlay=x='W*x(t)/100-w/2':y='H*y(t)/100-h/2':eval=frame`.

- [ ] **Step 1: Write the failing tests** (`test/movimento.test.js`)
  - `exprPorPartes` com `[{t:0,v:1},{t:0.35,v:0.38}]` avaliada (substituindo `t` e usando um mini avaliador de `if/lt` no teste) dá `1` em 0, `0.69` em 0,175, `0.38` em 1.
  - `um quadro vira constante`: `[{t:0,v:1.25}]` → `'1.25'`.
  - `filtroMovimento com fundo cor usa color=` e `com desfoque usa boxblur`; ambos terminam no rótulo `saida`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement** `lib/movimento.js`; em `montagem.js`, quando `c.movimento?.length`, inserir `filtroMovimento` logo depois do `scale…crop` (antes de filtros de cor), mantendo o resto da cadeia. Clipe sem `movimento`: cadeia idêntica à de hoje.
- [ ] **Step 4:** `npm test` → PASS; exportação manual de uma edição antiga (sem `movimento`) continua gerando o mesmo MP4.
- [ ] **Step 5: Commit** — `git commit -m "Exportação: movimento da imagem (zoom, canto, meia tela)"`

---

### Task 5: Camada de sobreposições na exportação

**Files:**
- Create: `lib/sobreposicoes.js`
- Modify: `lib/montagem.js` (entre o encadeamento dos clipes e o bloco de textos/legendas, ~linha 195); `server.js` `resolverEdicao` (~linha 678)
- Test: `test/sobreposicoes.test.js`

**Interfaces:**
- Consumes: `tl.sobreposicoes` (Task 3).
- Produces:
  - `filtrosSobreposicoes({ sobreposicoes, rv: string, indiceEntrada: (arquivo) => number, total: number }) -> { filtros: string[], rv: string }` — por item: `[k:v]format=rgba,setpts=PTS-STARTPTS+<inicio>/TB,scale=<w>:<h>[ovN]` e `<rv>[ovN]overlay=<x>:<y>:enable='between(t,<inicio>,<fim>)':eof_action=pass:format=auto[soN]`; itens com `inicio >= total` são ignorados; lista vazia → `{ filtros: [], rv }` (mesmo rótulo).
  - `resolverEdicao` passa a devolver `sobreposicoes` com `arquivo = dados/edicoes-ia/<edicaoId>/elementos/<elId>/render.mov`, **ignorando** as que não existem no disco (Review Focus 5).

- [ ] **Step 1: Write the failing tests** (`test/sobreposicoes.test.js`)
  - `lista vazia não muda o grafo`: `{ filtros: [], rv: '[cv3]' }`.
  - `cada sobreposição vira overlay com enable no tempo certo`: 1 item `{inicio:2.5,fim:3,x:108,y:192,w:864,h:384}` → filtros contêm `setpts=PTS-STARTPTS+2.5/TB`, `scale=864:384`, `overlay=108:192:enable='between(t,2.5,3)'`, e `rv` novo é `[so0]`.
  - `item depois do fim do vídeo é ignorado`.
  - `resolver ignora sobreposição cujo arquivo sumiu`: extrair a parte de sobreposições de `resolverEdicao` para `resolverSobreposicoes(lista, pastaEdicoes, existe = existsSync)` em `lib/sobreposicoes.js` e testar com `existe` falso → lista vazia.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement**; em `montagem.js` cada arquivo entra com `entrada('-i', arquivo)` e o `rv` resultante segue para o bloco de textos/legendas.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Exportação: camada de elementos sobrepostos"`

---

### Task 6: Render com transparência

**Files:**
- Modify: `lib/render.js` (`renderizarHtml`, linhas ~108–185)
- Test: `test/integracao/render-transparente.test.js` (roda Chromium; marcado com `{ skip: !process.env.INTEGRACAO }`)

**Interfaces:**
- Produces: `renderizarHtml({ ...atuais, transparente: true, saidaPreview?: string })` — com `transparente`: `Emulation.setDefaultBackgroundColorOverride({ color:{r:0,g:0,b:0,a:0} })`, captura `format:'png'`, ffmpeg lê `-vcodec png` e grava `-c:v png -pix_fmt rgba` em `o.saida` (.mov); se `saidaPreview`, converte depois para `-c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 32 -auto-alt-ref 0`. Sem `transparente`: comportamento atual inalterado.

- [ ] **Step 1: Write the failing test**: HTML de 0,5 s com fundo transparente e um quadrado; `renderizarHtml({ url: 'data:text/html,…', largura: 200, altura: 200, fps: 10, duracao: 0.5, saida: tmp/a.mov, saidaPreview: tmp/a.webm, transparente: true })`; `ffprobe` do .mov tem `pix_fmt=rgba`; o .webm tem `TAG:alpha_mode=1`.
- [ ] **Step 2:** `INTEGRACAO=1 node --test test/integracao/` → FAIL.
- [ ] **Step 3: Implement** a opção em `render.js`.
- [ ] **Step 4:** `INTEGRACAO=1 node --test test/integracao/` → PASS; `npm test` continua passando (o teste de integração é pulado sem a variável).
- [ ] **Step 5: Commit** — `git commit -m "Render: modo transparente (.mov PNG + prévia WebM com alfa)"`

---

### Task 7: Preparação — normalizar, emendar, silêncios, quadros, transcrição

**Files:**
- Create: `lib/edicao-ia/preparar.js`
- Test: `test/preparar.test.js`

**Interfaces:**
- Consumes: `FFMPEG`, `sondar(arquivo) -> { duracao, temAudio, largura, altura, … }` (`lib/ffmpeg.js`); `transcrever({ arquivo, pastaTemp, idioma:'pt', sinal })`; `analisarVideo({ video, pasta, duracao }) -> { folhas, … }`.
- Produces:
  - `argsNormalizar({ entrada, saida, temAudio }) -> string[]` (puro) — `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p`; com `temAudio=false` acrescenta `-f lavfi -i anullsrc=r=48000:cl=stereo -shortest`; áudio `-c:a aac -ar 48000 -ac 2`; vídeo `libx264 -crf 18 -preset fast`. (A rotação do celular é aplicada automaticamente pelo ffmpeg ao decodificar.)
  - `listaConcat(arquivos: string[]) -> string` (puro) — linhas `file '<caminho>'` com `'` escapado como `'\''` e barras normalizadas.
  - `lerSilencios(stderr: string) -> Array<{inicio, fim}>` (puro) — de `silence_start:`/`silence_end:`.
  - `prepararEdicao({ pasta, fontes: string[], sinal, progresso }) -> { duracao, segmentos, transcricao, silencios, folhas, candidatos }` — grava `fontes/NN.mp4`, `base.mp4`, `segmentos.json`, `transcricao.json`, `silencios.json`, `quadros/`.

- [ ] **Step 1: Write the failing tests** (`test/preparar.test.js`)
  - `normalizar cobre e corta para 1080x1920` (Review Focus 1): args contêm `force_original_aspect_ratio=increase,crop=1080:1920` e `fps=30`.
  - `vídeo sem áudio ganha silêncio` (Review Focus 2): `temAudio:false` → contém `anullsrc=r=48000:cl=stereo` e `-shortest`.
  - `lista do concat escapa espaço, acento e apóstrofo` (Review Focus 3): `listaConcat(["C:\\A2 SYSTEM\\vídeo d'ela.mp4"])` → `"file 'C:/A2 SYSTEM/vídeo d'\\''ela.mp4'\n"`.
  - `lerSilencios` de um stderr de exemplo com 2 silêncios → 2 intervalos.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement**; emenda com `-f concat -safe 0 -i lista.txt -c copy base.mp4` (todas as fontes já normalizadas iguais); `segmentos` pelas durações de `sondar`; silêncios com `-af silencedetect=n=-35dB:d=0.4 -f null -`; `candidatos` via `candidatosDeCorte` (Task 1).
- [ ] **Step 4:** `npm test` → PASS. Manual: dois vídeos curtos (um horizontal) na pasta temporária → `base.mp4` 1080×1920 com a soma das durações.
- [ ] **Step 5: Commit** — `git commit -m "Edição IA: preparação dos vídeos"`

---

### Task 8: Elementos — pedido, geração e render

**Files:**
- Create: `lib/edicao-ia/elementos.js`
- Test: `test/elementos.test.js`

**Interfaces:**
- Consumes: `gerarComClaude({ pedido, modelo, aoProgresso, sinal }) -> { html, custo }`; `consertarHtml(html)`; `renderizarHtml` (Task 6); `plano.estilo`; `transcricao.palavras`.
- Produces:
  - `palcoDoElemento(el) -> { largura, altura }` — `sobre` → `round(regiao.w% × 1080)` × `round(regiao.h% × 1920)`; `tela-cheia` → 1080×1920.
  - `montarPedidoElemento({ el, estilo, palavras }) -> string` — inclui descrição, texto na tela, duração `fim − inicio`, palco, as palavras faladas dentro do elemento com tempo **relativo ao início do elemento**, e as regras técnicas da spec seção 8 (fundo transparente em `sobre`, fundo próprio em `tela-cheia`, começa sozinho, dirigido por tempo, entra e sai animado).
  - `ehLimiteClaude(erro) -> boolean` — `/limit|usage limit|weekly/i`.
  - `gerarElemento({ el, estilo, palavras, pasta, url, modelo, sinal, aoProgresso }) -> { versao, custo }` — grava `elementos/<id>/v<n>.html` (depois de `consertarHtml`; se sobrar erro, uma chamada de correção com o erro no pedido) e renderiza `render.mov` + `preview.webm` com `transparente: true` (`url` é a rota que serve o HTML, Task 9).

- [ ] **Step 1: Write the failing tests** (`test/elementos.test.js`)
  - `palco de sobre usa a regiao em pixels`: `{camada:'sobre', regiao:{x:0,y:0,w:50,h:25}}` → `{540, 480}`.
  - `pedido traz tempos relativos`: elemento 10–12 s, palavra em 10,5 s → pedido contém `0.50`.
  - `pedido exige fundo transparente só em sobre` (`/transparent/` presente em `sobre`, ausente em `tela-cheia`).
  - `ehLimiteClaude reconhece "You've hit your weekly limit"` e rejeita `"ffmpeg: erro"`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement** em `lib/edicao-ia/elementos.js`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Edição IA: geração e render de elementos"`

---

### Task 9: Rotas, estado em disco e fila

**Files:**
- Create: `lib/rotas-edicao-ia.js`
- Modify: `server.js` (import e `registrarRotasEdicaoIa(app, { DADOS, PASTAS, BASE, criarJob, msgJob, jobPublico, lerJson, gravarJson, registrarMidia, naFila })` ao lado de `registrarRotasGerador`)
- Test: `test/estado-edicao-ia.test.js`

**Interfaces:**
- Consumes: Tasks 2, 3, 7, 8.
- Produces (pasta `dados/edicoes-ia/<id>/`, estado conforme spec seção 4):
  - `recuperarEstado(estado) -> estado` (pura) — elementos `gerando`/`renderizando` voltam para `fila`; `etapa:'gerando'` sem fila ativa vira `pausado`.
  - Rotas (JSON, mensagens em pt-BR):
    - `GET /api/edicao-ia` lista; `POST /api/edicao-ia` `{ nome }` → `estado`.
    - `POST /api/edicao-ia/:id/videos?nome=` corpo cru (como `/api/kie/imagem`); `PUT /api/edicao-ia/:id` `{ ordem, briefing, automatico }`; `DELETE /api/edicao-ia/:id/videos/:nome`.
    - `POST /api/edicao-ia/:id/preparar` → job tipo `edicao-ia` (prepara e, em seguida, planeja; no modo automático segue para gerar e montar).
    - `POST /api/edicao-ia/:id/planejar` `{ instrucao? }` (refazer o plano); `PUT /api/edicao-ia/:id/plano` (edições da revisão → `validarPlano` de novo).
    - `POST /api/edicao-ia/:id/gerar` (fila de elementos, um por vez, render via `naFila`); `POST /api/edicao-ia/:id/continuar` (depois de pausa por limite); `POST /api/edicao-ia/:id/elementos/:elId/refazer` `{ instrucao }`.
    - `POST /api/edicao-ia/:id/montar` — copia `base.mp4` para a Mídia como `edicao-ia-<id>-base.mp4` (`registrarMidia`), guarda a edição atual em `dados/edicao-anterior-<AAAAMMDD-HHmm>.json`, grava `montarEdicao(...)` em `dados/edicao.json`.
    - `GET /edicao-ia/:id/elementos/:elId/v:n.html` (para o render) e `GET /edicao-ia/:id/elementos/:elId/preview.webm` (prévia).
  - Transcrição sem nenhuma palavra → etapa `erro` com "Não encontrei fala no vídeo."
  - Envio de arquivo sem faixa de vídeo (`sondar` sem largura/altura) ou com extensão fora de `mp4|mov|m4v|webm|mkv` → 400 "Envie um arquivo de vídeo." e o arquivo é apagado.

- [ ] **Step 1: Write the failing tests**: `recuperarEstado` com elementos `gerando` e `pronto` → `fila` e `pronto`; etapa `gerando` → `pausado`; `extensaoDeVideo('foto.png')` → falso e `('take 1.MOV')` → verdadeiro (função pura exportada para a checagem do envio).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement**; ao registrar, aplica `recuperarEstado` em todas as edições do disco; erro com `ehLimiteClaude` → elemento volta para `fila`, etapa `pausado`, `estado.erro = 'Limite do Claude atingido — clique em Continuar quando ele voltar.'`.
- [ ] **Step 4:** `npm test` → PASS; manual com `curl`: criar, enviar 2 vídeos, preparar, ver `plano.json`.
- [ ] **Step 5: Commit** — `git commit -m "Edição IA: rotas, estado e fila"`

---

### Task 10: Aba ✂ Edição IA

**Files:**
- Modify: `public/index.html` (botão `data-vista="edicaoia"` "✂ Edição IA" depois de "⚡ Opus Generator"; `<main id="vista-edicaoia">`), `public/app.js` (nova seção antes de `function seguirHash()`; `irPara` chama `abrirEdicaoIa()`; `'edicaoia'` na lista do `seguirHash`; contador `edicao-ia` em "tarefas ativas"), `public/style.css` (prefixo `.eia-`)

**Interfaces:**
- Consumes: rotas da Task 9; `api`, `toast`, `acompanharJob`, `irPara`, `carregarMidia`, `carregarEdicao` do `app.js`.

- [ ] **Step 1:** Tela de envio: soltar/escolher vários vídeos (`multiple`), lista com miniatura e duração, **arrastar para reordenar**, apagar, briefing, caixa "Fazer tudo automático", botão **Preparar e planejar**.
- [ ] **Step 2:** Tela de revisão: linha do tempo com as frases; trechos cortados riscados (clicar desfaz o corte); cards de elementos e movimentos no tempo (editar descrição/texto/início/fim, apagar); campo + botão **Refazer o plano**; botão **Gerar elementos**.
- [ ] **Step 3:** Tela de geração: cards com status (`fila`/`gerando`/`renderizando`/`pronto`/`erro`), prévia do `preview.webm` sobre fundo xadrez, **Tentar de novo** no erro, aviso de pausa com **Continuar**; botão **Montar no Editor** (confirma que a edição atual será guardada) → `carregarEdicao()` + `irPara('editor')`.
- [ ] **Step 4: Verificar no navegador** (preview do estúdio): fluxo inteiro com 2 vídeos curtos; console sem erros; reordenar muda o `estado.ordem`.
- [ ] **Step 5: Commit** — `git commit -m "Aba Edição IA"`

---

### Task 11: Editor — faixa Elementos, prévia e movimento

**Files:**
- Modify: `public/index.html` (linha `🎞 Elementos` antes de `🅣 Textos`, ~linha 203; camada `<div id="palcoSobre">` dentro de `#palco`), `public/app.js` (`carregarEdicao` garante `ed.sobreposicoes = []`; `desenharTimeline` desenha `#tlElementos`; seleção/arraste/apagar como os textos, tipo `'e'`; `mostrarQuadro` posiciona os `<video>` de `preview.webm` ativos e sincroniza `currentTime`; aplica `transform` em `#palcoMidia` a partir de `clipe.movimento` interpolado; inspetor do elemento com **Apagar** e **Refazer** (instrução → rota da Task 9 → recarrega a prévia); inspetor do clipe lista os movimentos com **Remover movimento**), `public/style.css`

- [ ] **Step 1:** Faixa e blocos de elementos (arrastar no tempo, alça de fim, apagar, desfazer/refazer pelo histórico que já existe).
- [ ] **Step 2:** Prévia: elementos ativos tocando por cima no palco, na posição/tamanho certos, em sincronia com o cabeçote e com play/pause.
- [ ] **Step 3:** Movimento na prévia (`transform: translate/scale` no `#palcoMidia` com fundo desfocado via `filter: blur` numa cópia) e no inspetor do clipe.
- [ ] **Step 4: Verificar no navegador**: abrir uma edição montada pela Task 10; tocar; mover um elemento; exportar e conferir no MP4 que elementos, zoom/canto e legendas aparecem nos tempos certos.
- [ ] **Step 5: Commit** — `git commit -m "Editor: faixa de elementos, prévia e movimento"`

---

### Task 12: Documentação, teste de ponta a ponta e publicação

**Files:**
- Modify: `CURSO.md` (nova seção "5.10 Edição IA"), `COMO-USAR.md` (bloco curto da aba), `README.md` (se listar abas)

- [ ] **Step 1:** Ponta a ponta com um vídeo real de ~15 s da pessoa, enviado em **dois arquivos**: ordem, cortes, plano criativo, elementos com transparência, montagem, exportação. Medir e anotar no CURSO o custo/tempo (R1).
- [ ] **Step 2:** Atualizar CURSO.md e COMO-USAR.md com o fluxo e as dicas (revisar o plano gasta menos limite; "Continuar" depois do limite).
- [ ] **Step 3:** `npm test` → todos passam.
- [ ] **Step 4:** Checagens de segurança dos Global Constraints e `git push`.
- [ ] **Step 5: Commit** — `git commit -m "Edição IA: documentação"`
