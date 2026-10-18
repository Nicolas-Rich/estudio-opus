# Sonorizar um vídeo — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** na aba Efeitos, abrir qualquer vídeo da Mídia, analisar (itens, cortes e fala), sugerir sons da biblioteca, ajustar numa linha do tempo de arrastar com prévia sincronizada e exportar o MP4 com efeitos (−14 LUFS) para a Mídia.

**Arquitetura:**
- **Módulos puros** em `lib/sonorizar/`: `papeis`, `sugerir`, `enfases` e `sessao`, além de `exportar`, que reusa `faixa-itens` e `aplicarAudioNoVideo`.
- **Análise:** uma função com dependências injetáveis (`analisarParaSonorizar`).
- **API:** `lib/rotas-sonorizar.js`.
- **Catálogo:** um cache compartilhado em `lib/biblioteca/cache.js`.
- **Interface:** um modo novo dentro da seção EFEITOS de `public/app.js`.

**Stack:** Node 24 ESM, Express, ffmpeg-static, Web Audio (prévia) e `node --test`. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-18-sonorizar-video-design.md`. Leia junto com este plano.

## Restrições globais

- As sonorizações ficam em `dados/efeitos-sonorizacoes/<id>.json`. O `id` é sha1(nome na Mídia) com 12 caracteres. O arquivo é gravado de forma **atômica** (`.tmp` + rename). Nada de `dados/` vai para o git.
- **Papéis** (as categorias em ordem, a duração máxima do som e o volume padrão):

  | Papel | Categorias | Duração máx. | Volume |
  |---|---|---|---|
  | `item-pequeno` | clique, ui, tique | 0,6 s | 0,7 |
  | `item-grande` | impacto, grave | 1,5 s | 0,9 |
  | `saida` | swish, whoosh | 1,5 s | 0,6 |
  | `movimento` | whoosh, swish | 1,5 s | 0,6 |
  | `digitacao` | teclado, tique, clique | 0,4 s | 0,5 |
  | `corte` | whoosh, impacto | 1,5 s | 0,8 |
  | `enfase:<cat>` | a própria categoria (impacto, brilho, whoosh, grave, riser, clique) | 3 s | 0,9 |

- Um item é grande com área **≥ 2%**.
- **Kit:** pontuação `10·favorito + 3·macio + 1·(é fatia) − duracao`. Ficam os 3 melhores, sem repetir o arquivo de origem.
- **Momentos:**
  - fusão a **< 60 ms**, com a prioridade ênfase > corte > item-grande > os demais;
  - densidade **sutil 2/s, equilibrado 3,5/s, intenso 5/s** (cota acumulada por segundo);
  - um corte da análise a **< 0,3 s** de um evento `corte` do detector é descartado;
  - o riser começa em `max(0, t − duração do som)`.
- **Ênfases:** só as categorias `impacto, brilho, whoosh, grave, riser, clique`; no máximo **1 a cada 2 s**; timeout de **3 min**; uma falha devolve `[]`.
- **Clipe manual:** volume **0,8**, papel `manual`. `volume` fica em [0, 1,5]. Os padrões da sonorização são `volumeEfeitos` **0,8** e intensidade `'equilibrado'`.
- **Exportação:** o MP4 vai para a Mídia com o título `<título> (com efeitos)` e `origem: 'efeitos'`. O original nunca é alterado.
- **Interface:** textos em português; salvar com espera de **600 ms**; zoom de **1× a 8×**; bloco com **mínimo de 6 px**.
- **Antes de cada push** valem as checagens de segurança de sempre:
  - nenhuma chave de `dados/config.json` no índice;
  - nada de `dados/` no commit;
  - sem nomes pessoais ou de marca;
  - commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Foco da revisão

1. **Nome da Mídia com espaços, acentos e parênteses:** o `id` é estável, e as URLs (`/arquivos/midia/…`, rotas) funcionam → testes nas Tarefas 3 e 6.
2. **Nada detectado** (vídeo estático, sem fala, sem cortes): nenhuma sugestão, aviso claro e a faixa continua editável → testes nas Tarefas 1 e 6.
3. **Clipe perto do fim**, com um som que passa da duração: a exportação corta sem erro e mantém a duração do vídeo → teste na Tarefa 5.
4. **Abrir de novo enquanto a análise roda:** não pode iniciar uma segunda análise; devolve o job em andamento → teste na Tarefa 6.
5. **Exportar duas vezes:** dois arquivos diferentes na Mídia (`nomeLivre`), com o original intacto → teste na Tarefa 6.

---

### Tarefa 1: Papéis, kit e sugestões (`lib/sonorizar/papeis.js`, `lib/sonorizar/sugerir.js`)

**Arquivos:**
- Criar: `lib/sonorizar/papeis.js`, `lib/sonorizar/sugerir.js`
- Teste: `test/sonorizar-sugerir.test.js`

**Interfaces:**
- Consome: o formato `Evento` de `lib/eventos-visuais.js` e o formato `Som` do catálogo (`id, pai, arquivo, categoria, duracao, macio, nome`).
- Produz:
  - `PAPEIS: { [papel]: { categorias: string[], duracaoMax: number, volume: number } }`, para os papéis fixos da tabela;
  - `papelEnfase(categoria) → { categorias: [categoria], duracaoMax: 3, volume: 0.9 }`;
  - `papelDoEvento(evento) → string | null`;
  - `montarKit(sons, { favoritos = new Set(), papeis }) → { kit: { [papel]: Som[] }, faltando: string[] }`.
    - `papeis` é a lista dos papéis usados, incluindo `enfase:<cat>`;
    - `faltando` traz os **rótulos** de `CATEGORIAS` (`lib/biblioteca/classificar.js`) da 1ª categoria de cada papel sem candidato, sem repetir.
  - `sugerirClipes({ eventos = [], cortes = [], enfases = [], kit, intensidade = 'equilibrado', duracao }) → { uid, somId, t, volume, papel }[]`, ordenado por `t`.

- [ ] **Passo 1: testes que falham.**
  - **`papelDoEvento`:**
    - `entra` + `digitacao` → `digitacao`;
    - `entra` com área 0,02 → `item-grande`;
    - `entra` com área 0,019 → `item-pequeno`;
    - `sai` → `saida`, `move` → `movimento`, `corte` → `corte`;
    - tipo desconhecido → `null`.
  - **`montarKit`:**
    - um favorito vence um macio, que vence uma fatia;
    - um som com duração acima da máxima do papel fica fora;
    - duas fatias do mesmo `pai` → só uma no kit;
    - nunca mais de 3 por papel;
    - biblioteca sem `teclado`/`tique`/`clique` → `faltando` contém `'Teclado'`.
  - **`sugerirClipes`:**
    - 4 entradas pequenas com kit de 3 sons → `somId` A, B, C, A;
    - uma ênfase e um item a 40 ms → só o clipe da ênfase;
    - 100 entradas em 10 s, sutil → ≤ 20 clipes;
    - um corte da análise a 0,2 s de um evento `corte` → 1 clipe só;
    - ênfase `riser` em t = 5 com som de 2 s → clipe em t = 3; em t = 1 → clipe em t = 0;
    - papel sem kit → nenhum clipe daquele papel;
    - (Foco 2) sem eventos, cortes nem ênfases → `[]`.
- [ ] **Passo 2:** `node --test test/sonorizar-sugerir.test.js` → falha (módulo inexistente).
- [ ] **Passo 3: implementar** as regras da spec §1–2 e das Restrições.
- [ ] **Passo 4:** os testes passam, e `npm test` fica verde.
- [ ] **Passo 5: commit** `Sonorizar vídeo: papéis, kit e sugestões`.

### Tarefa 2: Ênfases da fala (`lib/sonorizar/enfases.js`)

**Arquivos:**
- Criar: `lib/sonorizar/enfases.js`
- Teste: `test/sonorizar-enfases.test.js`

**Interfaces:**
- Consome: `perguntarClaude` de `lib/claude.js` (é o padrão do parâmetro `perguntar`).
- Produz: `pedirEnfases({ frases, palavras, duracao, perguntar = perguntarClaude, sinal }) → Promise<{ t, categoria, motivo }[]>`.

- [ ] **Passo 1: testes que falham** (com stub de `perguntar`).
  - Uma resposta JSON com 4 itens, um com `t = -1`, um com categoria `explosao` e dois a 1 s um do outro → devolve 2 itens: o `t` limitado a 0, a categoria inválida descartada e só o 1º dos dois próximos.
  - O stub recebe `timeoutMs === 180000`, e o pedido contém o texto das frases com os tempos.
  - Stub que lança erro → `[]`. Texto sem JSON → `[]`.
  - `frases` vazio → `[]` sem chamar `perguntar`.
- [ ] **Passo 2:** ver falhar.
- [ ] **Passo 3: implementar.** O pedido em português lista `[inicio–fim] frase` e as palavras-chave com o tempo, e pede um bloco JSON `[{ "t", "categoria", "motivo" }]`.
- [ ] **Passo 4:** os testes passam, e `npm test` fica verde.
- [ ] **Passo 5: commit** `Sonorizar vídeo: ênfases da fala`.

### Tarefa 3: Sonorização salva (`lib/sonorizar/sessao.js`)

**Arquivos:**
- Criar: `lib/sonorizar/sessao.js`
- Teste: `test/sonorizar-sessao.test.js`

**Interfaces:**
- Produz:
  - `idDaMidia(nome) → string` (12 hexadecimais);
  - `novaSonorizacao({ midia, duracao, largura, altura, temAudio }) → objeto` com os padrões da spec §4 (`analise: null`, `clipes: []`);
  - `lerSonorizacao(pasta, id) → Promise<objeto | null>`;
  - `gravarSonorizacao(pasta, s) → Promise<void>` (atômica, atualiza `atualizado`);
  - `validarClipes(clipes, { duracao, idsValidos: Set }) → Clipe[]`.

- [ ] **Passo 1: testes que falham.**
  - `idDaMidia('meu vídeo (final) 2.mp4')` é igual em duas chamadas, tem 12 caracteres e é diferente de `idDaMidia('outro.mp4')` (Foco 1).
  - Gravar e ler devolvem o mesmo objeto. Depois de gravar, a pasta contém só o `.json` (nenhum `.tmp`).
  - Ler um id inexistente → `null`.
  - `validarClipes`:
    - descarta `somId` fora de `idsValidos`;
    - `t = -2` vira 0 e `t = 99` (duração 10) vira 10;
    - `volume = 3` vira 1,5;
    - `uid` ausente ganha um.
- [ ] **Passo 2:** ver falhar.
- [ ] **Passo 3: implementar.**
- [ ] **Passo 4:** os testes passam, e `npm test` fica verde.
- [ ] **Passo 5: commit** `Sonorizar vídeo: sonorização salva`.

### Tarefa 4: Catálogo compartilhado (`lib/biblioteca/cache.js`)

**Arquivos:**
- Criar: `lib/biblioteca/cache.js`
- Modificar: `lib/rotas-efeitos.js` (trocar `catalogo/porId/carregar` locais por `obterCatalogo(raiz)` e chamar `invalidarCatalogo()` depois de importar)
- Teste: `test/biblioteca-cache.test.js`

**Interfaces:**
- Consome: `lerCatalogo` de `lib/biblioteca/catalogo.js`.
- Produz: `obterCatalogo(raiz) → Promise<{ catalogo, porId: Map }>` (lê uma vez e guarda em cache por `raiz`) e `invalidarCatalogo()`.

- [ ] **Passo 1: testes que falham.**
  - Duas chamadas seguidas devolvem o **mesmo** objeto.
  - Depois de reescrever o `catalogo.json` e chamar `invalidarCatalogo()`, a próxima chamada vê o conteúdo novo.
  - `porId.get(id)` acha o som.
- [ ] **Passo 2:** ver falhar.
- [ ] **Passo 3: implementar e trocar em `rotas-efeitos.js`.** O teste `test/rotas-efeitos.test.js` precisa continuar verde.
- [ ] **Passo 4:** `npm test` verde.
- [ ] **Passo 5: commit** `Biblioteca de efeitos: catálogo compartilhado`.

### Tarefa 5: Montar e exportar (`lib/sonorizar/exportar.js`)

**Arquivos:**
- Criar: `lib/sonorizar/exportar.js`
- Teste: `test/sonorizar-exportar.test.js`

**Interfaces:**
- Consome:
  - `lerPcm`, `somarFaixa` e `gravarWav` (`lib/faixa-itens.js`);
  - `aplicarAudioNoVideo` (`lib/audio.js`, já masteriza em −14 LUFS);
  - `FFMPEG` (`lib/ffmpeg.js`).
- Produz:
  - `montarFaixaEfeitos({ clipes, sons: Map, raiz, duracao, volumeEfeitos, saida }) → Promise<string>`;
  - `exportarSonorizado({ video, temAudio, faixaEfeitos, saida, pastaTemp }) → Promise<void>`.

- [ ] **Passo 1: testes que falham.**
  - **`montarFaixaEfeitos`**, com 2 WAVs de clique numa raiz temporária (um deles fatia, com `inicio`/`fim`) e clipes em 0,5 s e 1,2 s → o WAV tem `duracao·48000` amostras (±1) e o pico perto de 24 000 e 57 600.
  - **(Foco 3)** Clipe em `duracao − 0,1` com um som de 1 s → sem erro e com a duração exata.
  - **Integração:**
    - um vídeo sintético de 3 s com um tom de 440 Hz a −30 dBFS, mais a faixa → o MP4 existe e mede −14 ± 1 LUFS;
    - um vídeo **sem** áudio (`temAudio: false`) também exporta, com áudio só dos efeitos.
- [ ] **Passo 2:** ver falhar.
- [ ] **Passo 3: implementar.**
  - O áudio original é extraído com `ffmpeg -i video -vn -ac 2 -ar 48000 orig.wav` em `pastaTemp`.
  - As faixas são `[{ arquivo: orig, tipo: 'voz', volume: 1 }, { arquivo: faixaEfeitos, tipo: 'efeitos', volume: 1 }]`.
  - Os temporários são apagados num `finally`.
- [ ] **Passo 4:** os testes passam, e `npm test` fica verde.
- [ ] **Passo 5: commit** `Sonorizar vídeo: montar e exportar`.

### Tarefa 6: Análise + API (`lib/sonorizar/analisar.js`, `lib/rotas-sonorizar.js`)

**Arquivos:**
- Criar: `lib/sonorizar/analisar.js`, `lib/rotas-sonorizar.js`
- Modificar: `server.js` (import e `registrarRotasSonorizar(app, { DADOS, PASTAS, criarJob, msgJob, jobPublico, lerJson, gravarJson, registrarMidia, nomeLivre })` logo após `registrarRotasEfeitos`)
- Teste: `test/rotas-sonorizar.test.js`

**Interfaces:**
- Consome: as Tarefas 1–5, mais:
  - `quadrosDoVideo`/`detectarEventos` (`lib/eventos-visuais.js`);
  - `analisarVideo` (`lib/analise-video.js`, usa `.cortes`);
  - `transcrever` (`lib/transcricao.js`);
  - `sondar` (`lib/ffmpeg.js`).
- Produz:
  - `analisarParaSonorizar({ video, temAudio, duracao, pastaTemp, sinal, aoMsg, deps }) → Promise<{ versao: 1, eventos, cortes, fala, enfases, pulados: string[] }>`.
    - `deps` = `{ eventos, cortes, transcrever, enfases }` (funções injetáveis; o padrão são as reais);
    - cada etapa que lança erro entra em `pulados` e não interrompe.
  - `registrarRotasSonorizar(app, ctx)` com as rotas da spec §7. O job de análise roda `analisarParaSonorizar` → `montarKit` → `sugerirClipes` e grava.
    - **Um job de análise por sonorização:** reabrir durante a análise devolve o mesmo job.

- [ ] **Passo 1: testes que falham** (express de teste, `DADOS` temporário, catálogo com 4 sons sintéticos de categorias diferentes, Mídia temporária com um MP4 sintético de 2 s cujo nome tem espaço e acento).
  - **`analisarParaSonorizar` com deps stub:**
    - `transcrever` lança erro → `pulados` contém `'fala'`, e as outras etapas vêm preenchidas;
    - `temAudio: false` → nem chama `transcrever`.
  - **`abrir` com biblioteca vazia** → 409 "Importe uma biblioteca de efeitos primeiro."
  - **`abrir` com análise injetada (stub nas deps)** → 200, o job termina e `GET /api/sonorizar/:id` traz `clipes` sugeridos, `sons` com nome/categoria/onda e `faltando`.
  - **(Foco 4)** Dois `abrir` seguidos durante a análise devolvem o **mesmo** `job.id`.
  - **(Foco 2)** Análise sem nada → `clipes: []` e o aviso `"Nada detectado"` na resposta.
  - **PATCH:**
    - com `somId` inválido e `t` fora → gravado só o válido, com `t` limitado;
    - `intensidade: 'sutil'` persiste.
  - **`sugerir`** substitui os clipes (a quantidade muda com a intensidade).
  - **Som que sumiu da biblioteca:** gravar uma sonorização com um `somId` inexistente e abrir de novo → o clipe some, e a resposta traz o aviso "1 som não está mais na biblioteca".
  - **(Foco 5)** `exportar` duas vezes, com stub de exportação injetado no ctx para não renderizar → dois nomes diferentes registrados, e o arquivo original na Mídia continua com o mesmo tamanho e data.
  - **(Foco 1)** `GET /api/sonorizar/videos` lista o vídeo com acento e espaço, e o id bate com `idDaMidia`.
- [ ] **Passo 2:** ver falhar.
- [ ] **Passo 3: implementar.**
  - `ctx` aceita `deps` opcionais (`analise`, `exportar`) só para teste. Em produção, `server.js` não as passa.
- [ ] **Passo 4:** os testes passam, `npm test` fica verde e `node --check server.js`.
- [ ] **Passo 5:** reiniciar o servidor (sem jobs ativos); `curl /api/sonorizar/videos` lista os vídeos da Mídia.
- [ ] **Passo 6: commit** `Sonorizar vídeo: análise e API`.

### Tarefa 7: Modo "Sonorizar vídeo" na aba Efeitos

**Arquivos:**
- Modificar: `public/app.js` (seção EFEITOS), `public/index.html` (alternância no topo da aba) e `public/style.css`.

**Interfaces:**
- Consome: as rotas da Tarefa 6, `/api/efeitos/sons`, `/api/efeitos/ouvir/:id` e `/arquivos/midia/<nome>`.

- [ ] **Passo 1:** alternância **📚 Biblioteca | 🎬 Sonorizar vídeo** e a grade de vídeos (`/api/sonorizar/videos`): miniatura, título, duração e "N sons".
- [ ] **Passo 2:** o editor da sonorização, conforme a spec §8:
  - vídeo com play/pause;
  - intensidade, **↻ Sugerir de novo** (com `confirm`) e **Exportar MP4** (com `acompanharJob`);
  - volume geral e avisos de `faltando`;
  - biblioteca lateral com linhas `draggable`.
- [ ] **Passo 3:** a linha do tempo:
  - régua com clique para posicionar;
  - blocos (cor e ícone por categoria; largura = duração, mínimo 6 px);
  - arrastar com pointer events;
  - soltar da biblioteca (`dragover`/`drop` com `somId`);
  - seleção com o inspetor (▶, volume, **Trocar**, **Remover**);
  - Delete e Espaço;
  - zoom de 1× a 8×.
  - O salvamento usa PATCH com espera de 600 ms.
- [ ] **Passo 4:** a prévia em Web Audio:
  - um `AudioContext` único;
  - buffers em cache por `somId`;
  - no `play`, agendar os clipes com `t ≥ currentTime`;
  - em `pause`, `seeked` ou edição, parar tudo (e reagendar se estiver tocando).
- [ ] **Passo 5: verificar no navegador do app** com um vídeo real da Mídia (uma animação renderizada):
  - as sugestões aparecem;
  - arrastar muda o `t` (e persiste depois de recarregar);
  - soltar da biblioteca cria um clipe;
  - **Trocar** e **Remover** funcionam;
  - com play, `AudioBufferSourceNode`s são criados (contagem via um contador exposto em `window.__efxPrevia` só para depuração);
  - o console fica sem erros.
- [ ] **Passo 6: commit** `Aba Efeitos: sonorizar um vídeo (linha do tempo e prévia)`.

### Tarefa 8: Verificação real, documentação e push

- [ ] **Passo 1:** sonorizar de ponta a ponta **dois** vídeos reais da Mídia: uma animação do estúdio e um vídeo de câmera falando.
  - Registrar quantas sugestões vieram de cada fonte (itens, cortes, ênfases).
  - Exportar os dois, medir −14 ± 1 LUFS e conferir que o original ficou intacto.
- [ ] **Passo 2:** enviar ao usuário os dois MP4 exportados.
- [ ] **Passo 3:** atualizar o `CURSO.md` (§5.10, com a subseção "Sonorizar um vídeo") e o `COMO-USAR.md` (aba Efeitos).
- [ ] **Passo 4:** rodar as checagens de segurança. Commit `Docs: sonorizar um vídeo` e `git push origin main`.
