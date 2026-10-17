# Sonoplastia item a item — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** cada item que entra, sai ou se move na animação ganha um som. São tons afinados em escadinha, um "tum" grave nos itens grandes, saídas em swish, deslizes e tiques. A densidade chega a 5 sons/s, e o MP4 final sai em −14 LUFS.

**Arquitetura:**
- Um detector por imagem (grade de 48 colunas a 15 fps) transforma a prévia leve da animação em eventos.
- O Claude define um kit: uma escala, um timbre e 3 texturas.
- Os tons são sintetizados no PC. As texturas vêm da ElevenLabs, com o tratamento ASMR.
- Regras puras mapeiam cada evento para um som. A faixa "itens" é somada em JavaScript e entra como um trecho a mais na mixagem que já existe.

**Stack:** Node 24 ESM, Express, ffmpeg-static, `node --test`. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-17-sonoplastia-item-a-item-design.md`. Leia junto com este plano.

## Restrições globais

- Textos da interface e mensagens de job em **português**; descrições para a ElevenLabs em **inglês**.
- Grade do detector: **48 colunas**, linhas proporcionais, **15 fps**, `scale=48:-2:flags=area`, `rgb24`.
- Densidade máxima: **sutil 2/s, equilibrado 3,5/s, intenso 5/s**. Fusão de eventos a **< 60 ms**.
- Escadinha: um grupo recomeça no grau 0 depois de **0,6 s** sem entradas. Item grande = área **≥ 2%**.
- Volume de item: **0,22–0,45** pela área. Saída: **70%** da entrada. Pan: `x*2−1`, limitado a **±0,6**.
- Nos momentos grandes, de **0,15 s antes até 0,4 s depois**, os sons de item ficam em **40%**. Nos `silencios`, ficam em **0**.
- Tom: ataque de **3 ms**, decaimento exponencial de **120–350 ms**. Deslize: **150–400 ms**.
- Master final: **−14 LUFS**, linear em duas passadas, limitador em **−1 dBTP**.
- O som por item só existe com `motor === 'elevenlabs'`. Síntese por código e biblioteca não mudam.
- Testes: `npm test`. Integração real com `INTEGRACAO=1`.
- Antes de cada push (regra do dono):
  - nenhuma chave de `dados/config.json` no índice (`git grep --cached -F`);
  - nada de `dados/` no commit;
  - sem nomes pessoais ou de marca;
  - commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Foco da revisão

1. **Fade lento** (item surgindo em 1 s) deve gerar **1** `entra`, não vários → teste na Tarefa 1.
2. **Partículas ou gradiente em movimento contínuo** cobrindo 30% da tela não podem inundar de eventos → teste na Tarefa 1.
3. **Fundo claro** (cenas brancas, como na referência): a classificação entra/sai precisa funcionar com item escuro sobre fundo branco → teste na Tarefa 1.
4. **Textura ausente** (a ElevenLabs falhou ou não deu permissão): o mapa não pode pedir `tum`/`tique`/`saida` inexistentes. Os tons continuam → teste na Tarefa 4.
5. **Vídeo longo** (120 s, ~600 eventos): a soma da faixa precisa ficar abaixo de 2 s e sem estouro de memória → teste na Tarefa 5.

---

### Tarefa 1: Detector de eventos (`lib/eventos-visuais.js`)

**Arquivos:**
- Criar: `lib/eventos-visuais.js`
- Teste: `test/eventos-visuais.test.js`

**Interfaces:**
- Produz:
  - `detectarEventos(quadros: Uint8Array[], { colunas, linhas, fps }) → Evento[]`, em que `Evento = { t, tipo: 'entra'|'sai'|'move'|'corte', x, y, area, grupo, dir, digitacao }`.
    - `x`, `y` e `area` vão de 0 a 1. `grupo` é um inteiro, ou null em saídas, movimentos e cortes. `dir` é `-1|0|1`. `digitacao` é booleano.
  - `quadrosDoVideo(video, { colunas = 48, fps = 15 }) → Promise<{ quadros, colunas, linhas, fps }>`.
  - `resumirEventos(eventos, duracao) → string` (texto em português para o Claude).

- [ ] **Passo 1: escrever os testes que falham.**
  - Use um helper `cena(colunas, linhas, n, fundo, desenhar(i, set))` que gera `n` quadros RGB.
  - Casos:
    - `quadrado 6×6 aparece no quadro 10 sobre preto` → exatamente 1 `entra`, com `t ≈ 10/15 ± 1/15`, `x,y` no centro do quadrado ±0,05 e `area ≈ 36/(48*27)`.
    - `o mesmo quadrado some no quadro 30` → 1 `sai` em ≈ 2,0 s.
    - `quadrado 4×4 andando 1 célula por quadro para a direita por 12 quadros` → ≥ 1 `move` com `dir === 1` e nenhum `entra` extra no meio do trajeto.
    - `6 quadradinhos 2×2 surgem numa linha a cada 2 quadros` → 6 `entra` com o mesmo `grupo` e `digitacao === true`.
    - `tela inteira troca de cor no quadro 20` → 1 `corte` e 0 `entra` nesse quadro.
    - `1 célula piscando` → 0 eventos.
    - (Foco 1) `quadrado surge com fade linear em 15 quadros` → exatamente 1 `entra`.
    - (Foco 2) `região de 30% da tela com ruído aleatório em todo quadro` → 0 `entra`.
    - (Foco 3) `fundo branco, quadrado preto aparece e depois some` → 1 `entra` seguido de 1 `sai`.
    - `resumirEventos` cita a contagem total e "por segundo" e lista no máximo 40 eventos, com tempo e tipo.

- [ ] **Passo 2: rodar `node --test test/eventos-visuais.test.js` e ver falhar** (módulo inexistente).

- [ ] **Passo 3: implementar seguindo a spec §1.** Este algoritmo os testes não determinam sozinhos:
  - **Distância:** `dist(a,b)` = maior diferença absoluta entre os canais.
  - **Célula ativa:** a célula está ativa no quadro `i` se `dist(c[i], c[i-1]) > 10`.
  - **Fundo:** é a mediana, por célula, dos valores em quadros inativos. A cada célula, recalcule de 15 em 15 quadros.
  - **Fim de um período ativo:**
    - um período curto (< 2 quadros) é ignorado;
    - um período que não estabiliza por 3 quadros em ≤ 45 quadros é ignorado (ruído ou partículas);
    - um período que estabiliza vira candidato `entra` se `dist(novo, fundo) > dist(antigo, fundo) + 20`, e `sai` no caso contrário com a mesma margem.
  - **Agrupar candidatos:** candidatos com instante de estabilização a ±2 quadros e vizinhança 8-conexa formam um item. `t` = início do período ativo. Descarte área < 2 células.
  - **Movimento:** a região ativa conexa que persiste > 5 quadros, com o centroide se deslocando > 3 células, gera `move` com `dir = sign(Δx)` (até 1 por região).
  - **Corte:** > 60% das células ativas num quadro gera `corte`, e os candidatos daquele quadro são suprimidos.
  - **Grupo e digitação:** veja a spec §1.
  - **`quadrosDoVideo`:** `spawn(FFMPEG, ['-i', video, '-vf', 'fps=15,scale=48:-2:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])`. Fatie o stdout em quadros. `linhas` vem do `ffprobe` (ou de `sondar`) da prévia, na mesma escala.

- [ ] **Passo 4: rodar os testes até passar.**

- [ ] **Passo 5: commit** `Sonoplastia: detector de itens que entram/saem por imagem`.

### Tarefa 2: Eventos na análise do vídeo

**Arquivos:**
- Modificar: `lib/rotas-audio.js` (`assistirVideo`, ~linha 378)
- Teste: `test/eventos-visuais.test.js` (integração, só com `INTEGRACAO=1`)

**Interfaces:**
- Consome: `quadrosDoVideo` e `detectarEventos` (Tarefa 1).
- Produz: `analise.eventos: Evento[]`, gravado em `analise.json`.

- [ ] **Passo 1: teste de integração** (pulado sem `INTEGRACAO=1`). Gere com ffmpeg um vídeo de 3 s, 480×270, fundo preto, com `drawbox` aparecendo em t = 1 s. Espere `detectarEventos(...(await quadrosDoVideo(v)))` com 1 `entra` em 1,0 ± 0,1 s.
- [ ] **Passo 2: ver falhar, implementar e ver passar** (o leitor já existe da Tarefa 1; este teste valida o ffmpeg real).
- [ ] **Passo 3: em `assistirVideo`:**
  - `fps: 15` na prévia;
  - antes de `fs.rm(video)`, calcule `analise.eventos`;
  - um cache cuja `analise` não tem `Array.isArray(eventos)` é refeito;
  - a mensagem do job ganha "N itens detectados".
- [ ] **Passo 4: `npm test` verde e commit** `Sonoplastia: análise do vídeo detecta os itens`.

### Tarefa 3: Síntese de tons afinados (`lib/sintese-tons.js`)

**Arquivos:**
- Criar: `lib/sintese-tons.js`
- Teste: `test/sintese-tons.test.js`

**Interfaces:**
- Produz:
  - `frequenciaDaNota({ tonica, modo, oitava }, grau) → number`. O grau 0 é a tônica na oitava dada. Graus acima do tamanho da escala sobem de oitava; graus negativos descem.
  - `sintetizarTom({ freq, timbre, duracao = 0.25, saida }) → Promise<string>`.
  - `sintetizarDeslize({ de, ate, timbre, duracao = 0.25, saida }) → Promise<string>`.
  - `MODOS = { pentatonica_maior: [0,2,4,7,9], pentatonica_menor: [0,3,5,7,10], maior: [0,2,4,5,7,9,11], dorico: [0,2,3,5,7,9,10] }`. `timbre ∈ 'sine'|'soft_fm'|'triangle'`.

- [ ] **Passo 1: testes que falham.**
  - `frequenciaDaNota({tonica:'A',modo:'pentatonica_maior',oitava:5},0) ≈ 880` (±0,5).
  - O grau 1 é ≈ 987,8.
  - O grau 5 é ≈ 1760.
  - O grau −1 é ≈ 739,99.
  - `sintetizarTom({freq:880,timbre:'sine'})` gera um WAV de 48 kHz estéreo com 0,2–0,4 s. A frequência dominante, contada por cruzamentos de zero no PCM lido com ffmpeg `-f f32le`, fica em 880 ± 1%.
  - Os outros dois timbres também geram arquivo válido.
  - `sintetizarDeslize({de:660,ate:990})`: a frequência nos primeiros 30 ms fica em ±5% de 660, e nos últimos 30 ms antes do decaimento, em ±5% de 990.
- [ ] **Passo 2: ver falhar.**
- [ ] **Passo 3: implementar** com `ffmpeg -f lavfi -i aevalsrc=...:s=48000:d=<dur>`. Os envelopes e timbres seguem as Restrições globais e a spec §3:
  - `sine` = seno + 2º harmônico a −18 dB;
  - `soft_fm` = `sin(2πft + I(t)·sin(4πft))`, com `I` caindo junto com o envelope a partir de 1,5;
  - `triangle` = `asin(sin(2πft))·2/π`, seguido de `lowpass=f=6000`.
  - Depois do `aevalsrc`, `pan=stereo|c0=c0|c1=c0` e `volume=-6dB`.
  - Deslize: a fase é a integral da frequência linear `f(t)=de+(ate-de)·t/dur` (use `de*t+(ate-de)*t*t/(2*dur)`).
- [ ] **Passo 4: ver passar e commit** `Sonoplastia: tons e deslizes afinados sintetizados no PC`.

### Tarefa 4: Mapeamento evento → som (`lib/mapa-itens.js`)

**Arquivos:**
- Criar: `lib/mapa-itens.js`
- Teste: `test/mapa-itens.test.js`

**Interfaces:**
- Consome: o formato `Evento` (Tarefa 1).
- Produz:
  - `mapearItens(eventos, { texturas: Set<'tum'|'saida'|'tique'>, notasPorOitava, intensidade, momentos: number[], silencios: {inicio,fim}[], duracao }) → Instancia[]`, em que `Instancia = { t, som: 'tom'|'tum'|'tique'|'saida'|'deslize', grau, ate, volume, pan }`.
    - `notasPorOitava` = `MODOS[modo].length`, da Tarefa 3.
    - `grau` vale para `tom`. `ate` é o grau final, para `deslize`.
  - `MOMENTOS_GRANDES = ['impacto','boom','hit','braam','stinger','reverse','riser']`.
  - `momentosDoPlano(lista) → number[]` (o `inicio` dos efeitos dessas categorias).

- [ ] **Passo 1: testes que falham.** Use as regras da tabela da spec §4 e as Restrições globais:
  - 4 `entra` pequenos do mesmo grupo a 0,2 s de distância → `tom` com graus 0, 1, 2, 3.
  - Uma 5ª entrada 0,8 s depois → grau 0 de novo.
  - `entra` com `area 0.05` → `tom` com `grau` `notasPorOitava` abaixo do equivalente pequeno (uma oitava; testar com 5 e com 7) e um `tum` no mesmo `t`.
  - `entra` com `digitacao` → `tique`, sem `tom`.
  - `sai` → `saida`, mais um `tom` com grau −1 em relação ao último do grupo. O volume é 70% da entrada equivalente.
  - `move` com `dir 1` → `deslize` com `ate > grau`; com `dir −1`, `ate < grau`.
  - `corte` → nada.
  - O pan de `x=1` é 0,6; o de `x=0,5`, 0.
  - 100 entradas em 10 s com `intensidade 'sutil'` → ≤ 20 instâncias de evento (os `tum` acompanham o seu `tom` e não contam). Ficam as de maior área.
  - Duas entradas a 40 ms → 1 instância.
  - Uma instância a 0,1 s antes de um momento → volume ×0,4. Dentro de um silêncio → removida.
  - (Foco 4) `texturas` vazio → só `tom` e `deslize`, nenhum `tum`/`tique`/`saida`. A digitação vira `tom` curto no grau atual.
- [ ] **Passo 2: ver falhar, implementar** (funções puras) **e ver passar.**
- [ ] **Passo 3: commit** `Sonoplastia: regras de som para cada item`.

### Tarefa 5: Faixa de itens somada em JavaScript (`lib/faixa-itens.js`)

**Arquivos:**
- Criar: `lib/faixa-itens.js`
- Teste: `test/faixa-itens.test.js`

**Interfaces:**
- Consome:
  - `Instancia` (Tarefa 4);
  - `frequenciaDaNota`, `sintetizarTom` e `sintetizarDeslize` (Tarefa 3);
  - `variacao(n)` de `lib/som-tatil.js`.
- Produz:
  - `lerPcm(arquivo) → Promise<[Float32Array, Float32Array]>` (48 kHz estéreo, via ffmpeg `f32le`);
  - `somarFaixa(instancias: { pcm, t, volume, pan }[], duracao) → [Float32Array, Float32Array]`;
  - `gravarWav(canais, arquivo) → Promise<void>` (PCM 16-bit, 48 kHz);
  - `montarFaixaItens({ instancias, kit, sons: { tum?, saida?, tique? }, pasta, duracao, saida }) → Promise<{ arquivo, total }>`.
    - Sintetiza cada tom e deslize distinto **uma vez**, com cache no nome do arquivo `tom-<timbre>-<freq>.wav`.
    - Lê cada som uma vez.
    - Aplica `variacao(n)` às repetições de texturas, via `asetrate` na leitura das variantes.

- [ ] **Passo 1: testes que falham.**
  - `somarFaixa` com um pulso de 10 amostras em t = 0,5 s, `pan −0,6` → o pico do canal L está em 24000 ± 1 amostra, com L > R.
  - A duração é exatamente `duracao·48000`.
  - Uma instância que ultrapassa o fim é cortada, sem erro.
  - `gravarWav` seguido de `lerPcm` devolve a mesma duração ±1 quadro.
  - (Foco 5) 600 instâncias de 0,3 s espalhadas em 120 s somam em < 2000 ms.
  - O pan é de potência constante: `L = cos((pan+1)·π/4)`, `R = sin(...)`.
- [ ] **Passo 2: ver falhar, implementar e ver passar.**
- [ ] **Passo 3: commit** `Sonoplastia: faixa de itens somada sem limite de entradas`.

### Tarefa 6: Kit no plano do Claude

**Arquivos:**
- Modificar:
  - `lib/sonoplastia-ia.js` (`planejarSonorizacao`, ~linhas 82–157, e `SISTEMA_SONOPLASTA`);
  - `lib/rotas-audio.js` (`audioPadrao` ~linha 29, `assinaturaEfeitos` ~linha 38, `planejar` ~linha 405, PATCH ~linha 222).
- Teste: `test/kit-som.test.js`

**Interfaces:**
- Consome: `resumirEventos` (Tarefa 1).
- Produz:
  - `normalizarKit(bruto) → { escala: { tonica, modo, oitava }, timbre, texturas: { tum, saida, tique } } | null`;
  - `planejarSonorizacao({..., eventos })` devolve `kit` também;
  - `efeitos.kit`, `efeitos.comItens` (padrão `true`) e `efeitos.kitVariantes` (`{tum:0,saida:0,tique:0}`) no estado.

- [ ] **Passo 1: testes que falham para `normalizarKit`.**
  - Os valores válidos passam.
  - `tonica` fora de `C C# D D# E F F# G G# A A# B` vira `'A'`.
  - Um `modo` desconhecido vira `pentatonica_maior`.
  - `oitava` fica limitada a 4–6.
  - Um `timbre` desconhecido vira `soft_fm`.
  - Uma textura vazia é omitida.
  - Uma entrada nula devolve `null`.
- [ ] **Passo 2: ver falhar, implementar e ver passar.**
- [ ] **Passo 3: no `planejarSonorizacao`:**
  - inclua `resumirEventos(eventos, duracao)` sob o título "ITENS QUE ENTRAM/SAEM (detectados nos quadros):";
  - acrescente `kit` no JSON de exemplo, com o formato da spec §3;
  - inclua o princípio 11 no `SISTEMA_SONOPLASTA`. Texto: os sons de item são automáticos; o plano em `efeitos` cuida só dos momentos grandes (cortes, revelações, logo); o kit deve ser coerente com o estilo; as texturas devem ser tácteis e macias.
- [ ] **Passo 4: no `planejar`:** passe `analise.eventos` e grave `au.efeitos.kit`.
  - Guarde `au.efeitos.analiseEventos = eventos.length + ':' + hash(eventos)` (uma string curta).
  - A `assinaturaEfeitos` inclui `e.comItens`, `e.kit`, `e.kitVariantes` e `e.analiseEventos`.
  - O PATCH aceita `comItens` e `kitVariantes`.
- [ ] **Passo 5: `npm test` verde e commit** `Sonoplastia: Claude define o kit de som do vídeo`.

### Tarefa 7: Integração na geração da sonoplastia

**Arquivos:**
- Modificar: `lib/rotas-audio.js` (rota `/audio/efeitos`, ramo ElevenLabs, ~linhas 460–530)

**Interfaces:**
- Consome:
  - `mapearItens` e `momentosDoPlano` (Tarefa 4);
  - `montarFaixaItens` (Tarefa 5);
  - `fonte` e `tratado` (locais da rota, com `ehTatil`);
  - a análise com eventos, de `assistirVideo` (Tarefa 2).
- Produz:
  - `efeitos.itens = { total, porSegundo, sons: { tum?, saida?, tique?: nomeArquivoTratado } }`, gravado no projeto;
  - a mensagem do job "Mixando N sons + M sons de item…".

- [ ] **Passo 1:** quando `e.comItens !== false && e.kit && eventos.length`:
  1. Gere cada textura com `fonte(descricao, 0.6, 'foley', kitVariantes[k] || 0)` e depois `tratado(..., { categoria: 'foley', descricao })`. Isso já aplica o ASMR. Uma falha é pulada e registrada com `msgJob`.
  2. Rode `mapearItens(eventos, { texturas: new Set(chaves obtidas), intensidade: e.intensidade, momentos: momentosDoPlano(e.lista), silencios: e.silencios, duracao })`.
  3. Rode `montarFaixaItens(...)` com `pasta: pastaProc` e `saida: itens-<assinatura>.wav`.
  4. Faça `trechos.push({ arquivo, inicio: 0, cortarInicio: 0 })`.
  5. Grave `efeitos.itens`.
- [ ] **Passo 2:** sem eventos, a mensagem do job é "nenhum item detectado — só os momentos grandes" e o fluxo segue como hoje.
- [ ] **Passo 3: `npm test` verde.** Verificação real na Tarefa 10.
- [ ] **Passo 4: commit** `Sonoplastia: som em cada item entra na mixagem`.

### Tarefa 8: Aba Som — linha "som em cada item" e kit

**Arquivos:**
- Modificar:
  - `public/app.js` (bloco da aba Som ~linhas 1020–1050, a visibilidade ~linha 1269 e os handlers ~linha 1391);
  - `public/style.css`.

**Interfaces:**
- Consome:
  - `efeitos.comItens`, `efeitos.kit`, `efeitos.kitVariantes` e `efeitos.itens` (Tarefas 6–7);
  - a rota `/p/:id/audio/sfx/:arquivo`, que já existe.

- [ ] **Passo 1:** depois da linha da trilha, `<label class="check" id="efItensLinha"><input type="checkbox" id="efItens"> ✓ Som em cada item que entra/sai</label>`.
  - Ela só aparece com `motor === 'elevenlabs'`.
  - O resumo é `N sons de item · X por segundo`, a partir de `efeitos.itens`.
- [ ] **Passo 2:** os chips do kit:
  - um chip `Escala: A pentatônica maior · soft_fm`;
  - um chip por textura gerada (`tum`, `saída`, `tique`), com ▶ (`audioAmostra.src = /p/<id>/audio/sfx/<arquivo>`) e ↻ (incrementa `kitVariantes[k]` e salva; a sonoplastia fica pendente).
- [ ] **Passo 3:** verificar no navegador do app.
  - Projeto com fonte ElevenLabs → a linha aparece. Trocando para síntese → some.
  - Desmarcar e recarregar → continua desmarcado.
  - ▶ toca o som.
  - O console não mostra erros.
- [ ] **Passo 4: commit** `Aba Som: som em cada item e kit do vídeo`.

### Tarefa 9: Master do MP4 em −14 LUFS

**Arquivos:**
- Modificar: `lib/audio.js` (`aplicarAudioNoVideo`, ~linha 363)
- Teste: `test/master.test.js` (usa ffmpeg; rápido)

**Interfaces:**
- Produz: `aplicarAudioNoVideo(video, faixas, saida)`, com a mesma assinatura. A mixagem passa por um WAV temporário: mede a loudness (`ebur128`), aplica um ganho fixo de `−14 − medido` dB (limitado a ±20) e `alimiter=limit=0.891` (−1 dBTP), e então codifica em AAC.

- [ ] **Passo 1: teste que falha.** Um vídeo preto de 4 s + uma faixa de tom de 440 Hz a −30 dBFS → o MP4 final mede −14 ± 1 LUFS.
- [ ] **Passo 2: ver falhar, implementar e ver passar.**
- [ ] **Passo 3: commit** `MP4 final masterizado em −14 LUFS`.

### Tarefa 10: Verificação real, documentação e push

- [ ] **Passo 1:** reiniciar o servidor (confira antes se há jobs ativos). No projeto real com animação, rodar `/audio/mapa` e depois `/audio/efeitos`.
  - Conferir: `efeitos.itens.total > 0`;
  - sons por segundo ≤ o limite da intensidade;
  - nenhum erro no job.
- [ ] **Passo 2:** montar o antes × depois em `dados/comparacoes/` (só efeitos e com voz, MP3 de 256 kbps) e enviar ao usuário.
  - Renderizar o MP4 e medir −14 ± 1 LUFS.
- [ ] **Passo 3:** atualizar `CURSO.md` (§5.5) e `COMO-USAR.md` (Sonoplastia) com "som em cada item", o kit e o master −14 LUFS.
- [ ] **Passo 4:** rodar as checagens de segurança das Restrições globais. Commit `Docs: sonoplastia item a item` e `git push origin main`.
