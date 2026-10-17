# Biblioteca de efeitos — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** importar pacotes de efeitos (Sonniss GDC) num catálogo que entende cada som (categoria, medidas e fatias) e criar a aba **"Efeitos"** para buscar, ouvir e favoritar.

**Arquitetura:**
- Quatro módulos em `lib/biblioteca/`:
  - `ucs.js` (nomes no padrão UCS) e `classificar.js` (regras e o Claude só por texto);
  - `medidas.js` (sinal puro em JavaScript);
  - `catalogo.js` (indexar e buscar);
  - `importar.js` (zips e espaço em disco).
- Um orquestrador `importarPacote` faz o pipeline completo, e `lib/rotas-efeitos.js` expõe a API e o job.
- A aba fica em `public/app.js`, no mesmo padrão da seção "Cenas IA" (`abrirKie`).

**Stack:** Node 24 ESM, Express, ffmpeg-static (ffmpeg/ffprobe), `tar.exe` do Windows (bsdtar) e `node --test`. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-17-biblioteca-de-efeitos-design.md`. Leia junto com este plano.

## Restrições globais

- **Sons e catálogo:**
  - Os sons ficam em `dados/biblioteca-sfx/<pacote>/`.
  - O catálogo fica em `dados/biblioteca-sfx/catalogo.json` (`versao: 1`).
  - Os favoritos ficam em `dados/efeitos-favoritos.json`.
  - O cache de fatias fica em `dados/biblioteca-sfx/.cache/`.
  - **Nada de `dados/` vai para o git.**
- **Categorias** (nesta ordem): `clique, tique, teclado, papel, ui, whoosh, swish, impacto, grave, riser, glitch, brilho, ambiente, foley, outros`.
- **Claude:** só texto, lotes de **150**, modelo `claude-sonnet-5-5`. Uma falha deixa o lote em `outros`.
- **Medidas e fatias:**
  - O PCM é mono a 48 kHz, com no máximo **60 s** decodificados.
  - Uma fatia separa onde o envelope fica **< −45 dB do pico por ≥ 150 ms**. Fatias de **< 40 ms** são descartadas. A margem é de **5 ms antes e 30 ms depois**.
  - Só fatia arquivos de **≤ 60 s** que resultem em **≥ 2 fatias**.
  - `brilho` é a fração da energia acima de 4 kHz; `aspereza`, a fração em 2–5 kHz.
  - `macio = 1 − clamp((aspereza − 0,05) / 0,25)`.
  - A mini-onda tem **48** pontos.
- **Busca:**
  - Curto < 0,6 s, médio de 0,6 a 3 s, longo > 3 s. Macio ≥ 0,6, áspero ≤ 0,4. Páginas de **60**.
  - Todas as palavras de `q` precisam aparecer (sem acento, minúsculas). Peso 2 no nome, 1 na descrição ou nas tags.
  - Sem `q`: favoritos primeiro, depois o nome.
- **Importação:**
  - Recusa se o espaço livre for **< 1,1 × o tamanho do zip**.
  - Os zips listados são os de **> 10 MB** em `~/Downloads`, os mais novos primeiro, com `sonniss: true` quando o nome tem "sonniss" ou "gdc".
  - Um caminho dentro de `dados/` é recusado.
- **Mensagens:**
  - "Espaço insuficiente: precisa de X GB livres, há Y GB"
  - "Esse pacote já está na biblioteca"
  - "N sons (M fatias) importados, K pulados"
- **Interface:** textos em português. Antes de cada push valem as mesmas checagens de segurança de sempre:
  - nenhuma chave de `dados/config.json` no índice;
  - nada de `dados/` no commit;
  - sem nomes pessoais ou de marca;
  - commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Foco da revisão

1. **Nomes difíceis** (espaços, vírgulas, acentos, parênteses, caminhos longos): indexar não pode quebrar. Um arquivo ilegível é pulado e contado → teste na Tarefa 3.
2. **Arquivo enorme** (ambiência de vários minutos, 96 kHz/24 bit): a duração precisa vir certa, decodificando só 60 s, sem estourar a memória → teste na Tarefa 3.
3. **Busca com acento e maiúscula** ("Papél", "CLIQUE"): precisa achar igual → teste na Tarefa 3.
4. **Importação que falha no meio** (zip corrompido): não pode sobrar pacote pela metade no catálogo nem pasta parcial → teste na Tarefa 5.
5. **Servidor caiu durante uma importação:** existe uma pasta do pacote, mas ele não está no catálogo. A nova importação do mesmo zip precisa funcionar (a duplicidade é checada pelo catálogo, e a pasta parcial é removida antes de extrair) → teste na Tarefa 5.

---

### Tarefa 1: Nome UCS e classificação (`lib/biblioteca/ucs.js`, `lib/biblioteca/classificar.js`)

**Arquivos:**
- Criar: `lib/biblioteca/ucs.js`, `lib/biblioteca/classificar.js`
- Teste: `test/biblioteca-classificar.test.js`

**Interfaces:**
- Produz:
  - `lerNomeUcs(nomeArquivo: string) → { catId, familia, descricao, criador } | null`;
  - `CATEGORIAS: { id, rotulo, icone }[]`, nas 15 categorias das Restrições;
  - `categoriaPorRegras({ ucs, nome, descricao }) → { categoria, tags: string[] } | null`;
  - `classificarComClaude(itens: {id, nome, descricao}[], { perguntar = perguntarClaude, modelo = 'claude-sonnet-5-5', sinal }) → Promise<Map<id, {categoria, tags}>>`.
    - `perguntar` é injetável para o teste e tem a mesma assinatura de `perguntarClaude` em `lib/claude.js:188`, devolvendo `{ texto }`.

- [ ] **Passo 1: testes que falham.**
  - `lerNomeUcs('WHSHAir_Fast Swoosh Short_ACME_SFX.wav')` → `{ catId: 'WHSHAir', familia: 'WHSH', descricao: 'Fast Swoosh Short', criador: 'ACME' }`.
  - `lerNomeUcs('meu som 01.wav')` → `null`.
  - `categoriaPorRegras`:
    - CatID `UIClick` → `clique`;
    - CatID `UIBeep` → `ui`;
    - CatID `DSGNImpt…` → `impacto`, mas `DSGNMisc…` sem palavra-chave → `null`;
    - nome "Typewriter Keys Fast" → `teclado`;
    - "paper rip" → `papel`;
    - "Glass shimmer sparkle" → `brilho`;
    - "Room Tone Office" → `ambiente`;
    - "Untitled 07" → `null`;
    - as tags de "Soft Wood Knock" incluem `suave` e `madeira`.
  - `classificarComClaude`:
    - 2 itens com o stub devolvendo um JSON válido → as categorias desse JSON;
    - stub com texto inválido → ambos em `outros`;
    - 310 itens → o stub é chamado 3 vezes (lotes de 150).
- [ ] **Passo 2:** `node --test test/biblioteca-classificar.test.js` → falha (módulo inexistente).
- [ ] **Passo 3: implementar.** As regras e a ordem estão na spec §2. As palavras-chave casam com fronteira de palavra (`\b`), sem diferenciar maiúsculas. O pedido ao Claude lista `id | nome | descricao` e as categorias permitidas, e pede de volta só um bloco JSON `[{ "id", "categoria", "tags" }]`. Categorias fora da lista viram `outros`.
- [ ] **Passo 4:** os testes passam, e `npm test` fica verde.
- [ ] **Passo 5: commit** `Biblioteca de efeitos: nomes UCS e classificação`.

### Tarefa 2: Medidas, fatias e mini-onda (`lib/biblioteca/medidas.js`)

**Arquivos:**
- Criar: `lib/biblioteca/medidas.js`
- Teste: `test/biblioteca-medidas.test.js`

**Interfaces:**
- Produz:
  - `medirSom(pcm: Float32Array, sr: number) → { ataqueMs, brilho, aspereza, pico, rms }` (`pico`/`rms` em dBFS);
  - `fatiar(pcm, sr) → { inicio, fim }[]`;
  - `miniOnda(pcm, n = 48) → number[]`;
  - `macioDe(aspereza) → number`.

- [ ] **Passo 1: testes que falham.** Os sinais são gerados no teste a 48 kHz.
  - 3 cliques (5 ms de ruído) em 0,2 / 0,6 / 1,0 s, num arquivo de 1,4 s → 3 fatias, com `inicio` a ±10 ms de 0,195 / 0,595 / 0,995.
  - Ruído contínuo de 2 s → `[]`.
  - Arquivo de 90 s com 3 cliques → `[]`.
  - Ruído branco com `brilho` maior que um seno de 200 Hz.
  - Seno de 3 kHz com `aspereza` maior que um seno de 300 Hz.
  - Ataque instantâneo → `ataqueMs < 10`. Fade de entrada de 200 ms → `ataqueMs > 100`.
  - `miniOnda` tem 48 valores entre 0 e 1, com o máximo = 1.
  - `macioDe(0.05) === 1`, `macioDe(0.30) === 0`, `macioDe(0.175) ≈ 0.5`.
- [ ] **Passo 2:** ver falhar.
- [ ] **Passo 3: implementar.** Use biquads RBJ: passa-alta de 4 kHz para o brilho e passa-faixa centrado em 3,16 kHz com Q ≈ 1,05 (≈ 2–5 kHz) para a aspereza, aplicados em JS. O envelope usa o máximo absoluto em janelas de 5 ms.
- [ ] **Passo 4:** os testes passam, e `npm test` fica verde.
- [ ] **Passo 5: commit** `Biblioteca de efeitos: medidas, fatias e mini-onda`.

### Tarefa 3: Catálogo — indexar e buscar (`lib/biblioteca/catalogo.js`)

**Arquivos:**
- Criar: `lib/biblioteca/catalogo.js`
- Teste: `test/biblioteca-catalogo.test.js`

**Interfaces:**
- Consome:
  - `lerNomeUcs` e `categoriaPorRegras` (Tarefa 1);
  - `medirSom`, `fatiar`, `miniOnda` e `macioDe` (Tarefa 2);
  - `lerPcm(arquivo, af)` de `lib/faixa-itens.js` (estéreo a 48 kHz; mono = média dos canais; limite com `af = 'atrim=0:60'`);
  - `FFPROBE` de `lib/ffmpeg.js`.
- Produz:
  - `indexarPacote({ raiz, pasta, pacote, aoProgresso, sinal }) → Promise<{ sons: Som[], arquivos, fatias, pulados }>`.
    - `raiz` = `dados/biblioteca-sfx`; `pasta` = a pasta do pacote dentro dela.
    - `Som` tem o formato da spec §4. A categoria vem de `categoriaPorRegras`, ou fica `null` para o Claude decidir depois.
  - `buscar(sons, { q, categoria, duracao, macio, favoritos: Set, soFavoritos, pagina = 0, porPagina = 60 }) → { total, itens }`;
  - `contarCategorias(sons) → { [categoria]: n }`;
  - `lerCatalogo(raiz)` e `gravarCatalogo(raiz, catalogo)`, no formato `{ versao: 1, pacotes: [], sons: [] }`;
  - `semAcento(s) → string`.

- [ ] **Passo 1: testes que falham.**
  - **Indexar** uma pasta temporária com WAVs gerados pelo ffmpeg no teste:
    - `UIClick_Soft Click_TST.wav` (0,1 s);
    - `teclas (x3), café.wav`, com 3 golpes, espaço, vírgula, acento e parênteses;
    - `ambiencia longa.wav` (90 s);
    - `quebrado.wav`, com bytes inválidos.

    Resultado esperado:
    - `arquivos === 3`, `pulados === 1`, `fatias === 3`;
    - as fatias têm `pai` = id do arquivo das teclas e nome terminando em "(golpe 1)" etc.;
    - `ambiencia longa.wav` tem `duracao ≈ 90` e o indexamento todo leva < 15 s.
  - **Buscar**, com uma lista fixa de `Som`:
    - "click metal" só devolve quem tem as duas palavras;
    - `categoria: 'clique', duracao: 'curto', macio: 'macio'` filtra junto;
    - "CLIQUE" e "papél" acham "clique" e "papel" (Foco 3);
    - um favorito vem primeiro sem `q`;
    - `pagina: 1` com `porPagina: 2` devolve o 3º e o 4º itens;
    - `contarCategorias` bate.
- [ ] **Passo 2:** ver falhar.
- [ ] **Passo 3: implementar.**
  - A descrição embutida vem de `ffprobe -show_entries format_tags=comment,description,title`.
  - O id é `sha1(arquivo + '#' + (inicio ?? ''))`, com os 12 primeiros caracteres.
  - Os arquivos são percorridos com `fs.readdir(..., { recursive: true })`, filtrando `/\.(wav|mp3|flac|ogg|aiff?)$/i`.
  - `aoProgresso(feitos, total)` é chamado a cada 20 arquivos.
- [ ] **Passo 4:** os testes passam, e `npm test` fica verde.
- [ ] **Passo 5: commit** `Biblioteca de efeitos: catálogo (indexar e buscar)`.

### Tarefa 4: Zips e espaço em disco (`lib/biblioteca/importar.js`)

**Arquivos:**
- Criar: `lib/biblioteca/importar.js`
- Teste: `test/biblioteca-importar.test.js`

**Interfaces:**
- Produz:
  - `listarZips(dir = path.join(os.homedir(), 'Downloads')) → Promise<{ nome, caminho, tamanho, sonniss }[]>`;
  - `espacoLivre(dir) → Promise<number>` (bytes, via `fs.promises.statfs`: `bavail * bsize`);
  - `extrairZip(zip, destino, { sinal }) → Promise<void>`:
    - no Windows: `path.join(process.env.SystemRoot, 'System32', 'tar.exe')` com `-xf zip -C destino`;
    - fora do Windows: `unzip -q zip -d destino`;
    - erro → `Error('Falha ao descompactar: …')`.

- [ ] **Passo 1: testes que falham.**
  - `listarZips(pastaTemp)` com um arquivo de 11 MB chamado `Sonniss.com-GDC2024-x.zip`, um `.zip` de 1 MB e um `.txt` → só o primeiro, com `sonniss: true`.
  - `espacoLivre(os.tmpdir()) > 0`.
  - `extrairZip`:
    1. o teste cria `a.zip` com o bsdtar (`tar.exe -a -cf a.zip -C pasta som.wav`);
    2. extrai em outra pasta;
    3. `som.wav` deve existir.
  - Um zip inválido (texto com extensão `.zip`) rejeita com uma mensagem que começa por "Falha ao descompactar".
  - Os casos que dependem do bsdtar são pulados fora do Windows.
- [ ] **Passo 2:** ver falhar.
- [ ] **Passo 3: implementar** conforme as Interfaces.
- [ ] **Passo 4:** os testes passam, e `npm test` fica verde.
- [ ] **Passo 5: commit** `Biblioteca de efeitos: zips e espaço em disco`.

### Tarefa 5: Importar um pacote de ponta a ponta + API (`lib/biblioteca/pacote.js`, `lib/rotas-efeitos.js`)

**Arquivos:**
- Criar: `lib/biblioteca/pacote.js`, `lib/rotas-efeitos.js`
- Modificar: `server.js` (import e `registrarRotasEfeitos(app, { DADOS, PASTAS, criarJob, msgJob, jobPublico, lerJson, gravarJson })`, junto a `registrarRotasKie`, ~linha 724)
- Teste: `test/biblioteca-pacote.test.js`

**Interfaces:**
- Consome: as Tarefas 1–4.
- Produz:
  - `importarPacote({ caminho, raiz, pastaZips = ~/Downloads, apagarZip = true, classificar = classificarComClaude, aoMsg, aoProgresso, sinal }) → Promise<{ pacote, arquivos, fatias, pulados }>`. O pipeline:
    1. valida o caminho:
       - um zip precisa existir **dentro de `pastaZips`**;
       - uma pasta precisa existir;
       - qualquer caminho dentro de `raiz`/`dados/` é recusado;
    2. define o nome do pacote (nome do zip sem extensão, ou nome da pasta);
    3. checa duplicidade **pelo catálogo** ("Esse pacote já está na biblioteca");
    4. checa o espaço (só para zip);
    5. remove uma pasta parcial que tenha sobrado;
    6. extrai (zip) ou usa a pasta como está;
    7. roda `indexarPacote`;
    8. classifica com o Claude os sons com `categoria === null` (as fatias herdam a categoria do pai);
    9. grava o catálogo com o pacote novo;
    10. apaga o zip se `apagarZip`.

    Em qualquer erro depois da extração, remove a pasta do pacote e não grava nada.
  - `registrarRotasEfeitos(app, ctx)` com as rotas da spec §6. O job da importação é criado por `criarJob('efeitos', { rotulo: 'Importando pacote' })`. Ao terminar, a mensagem é "N sons (M fatias) importados, K pulados".

- [ ] **Passo 1: testes que falham** (rodam sempre, porque o bsdtar existe no Windows; pulados fora dele).
  - **Zip** com 3 WAVs (um com 3 golpes), stub de `classificar` → catálogo com 3 arquivos + 3 fatias, `pacotes.length === 1`, e o zip apagado.
  - **Importar o mesmo zip de novo** (recriado) → rejeita com "Esse pacote já está na biblioteca".
  - **(Foco 4)** Zip corrompido → rejeita; o catálogo não muda e a pasta do pacote não existe.
  - **(Foco 5)** Pasta do pacote existindo com lixo, mas fora do catálogo → a importação funciona e o lixo some.
  - **Caminho dentro de `raiz`** → rejeita. **Zip fora de `pastaZips`** → rejeita.
- [ ] **Passo 2:** ver falhar.
- [ ] **Passo 3: implementar** `importarPacote` e as rotas.
  - `GET /api/efeitos/ouvir/:id`: se `inicio != null`, recorta com `ffmpeg -ss inicio -t (fim−inicio)` para `.cache/<id>.wav` (uma vez) e serve.
  - Os favoritos ficam num array de ids em `dados/efeitos-favoritos.json`.
  - O catálogo fica em memória e é recarregado ao fim de cada importação.
- [ ] **Passo 4:** os testes passam, e `npm test` fica verde. `node --check server.js`.
- [ ] **Passo 5:** reiniciar o servidor (sem jobs ativos).
  - `curl /api/efeitos/categorias` → `{ total: 0, … }`.
  - `curl /api/efeitos/zips` lista os zips.
- [ ] **Passo 6: commit** `Biblioteca de efeitos: importação e API`.

### Tarefa 6: Aba "Efeitos"

**Arquivos:**
- Modificar:
  - `public/index.html` (botão `<button data-vista="efeitos">🔊 Efeitos</button>` depois de "🎬 Cenas IA" e `<main id="vista-efeitos" class="vista">`);
  - `public/app.js` (seção `// ===== EFEITOS` com `abrirEfeitos()`, chamada em `irPara` como `if (vista === 'efeitos') abrirEfeitos();`);
  - `public/style.css`.

**Interfaces:**
- Consome: as rotas da Tarefa 5.

- [ ] **Passo 1: estado vazio** (`total === 0`), com os textos da spec §7.
  - O cartão Sonniss traz o link `https://sonniss.com/gameaudiogdc` e a licença em uma linha ("uso comercial livre, sem crédito; não redistribuir os sons").
  - A lista de `/api/efeitos/zips` aparece com o selo "Sonniss" e o botão **Importar**.
  - A caixa "apagar o .zip depois" vem marcada.
  - O campo "ou importar uma pasta" vem com um botão.
- [ ] **Passo 2: importação.** O botão inicia `POST /api/efeitos/importar` e acompanha com `acompanharJob`, mostrando a barra e a última mensagem. Ao terminar, recarrega a aba.
- [ ] **Passo 3: com biblioteca.**
  - **Coluna da esquerda:** chips de categoria (ícone, rótulo e contagem; "Todas" primeiro), busca com espera de 250 ms, filtros (Curto/Médio/Longo, Macio/Áspero, ★ Favoritos) e "＋ Importar outro pacote".
  - **Lista:** cada linha tem a mini-onda em SVG (48 barras a partir de `onda`), ▶, ★, o nome, o pacote, a duração e as tags, além do selo "golpe N" quando `pai`.
  - **Interação:**
    - clicar na linha toca o som (um `Audio()` único, com `src = /api/efeitos/ouvir/<id>`);
    - Espaço toca ou para;
    - ↑/↓ mudam a seleção e tocam o som;
    - "Carregar mais" pagina.
- [ ] **Passo 4: verificar no navegador do app** com um pacote pequeno de teste, importado pela pasta (os 3 WAVs sintéticos):
  - as contagens aparecem;
  - a busca filtra;
  - ▶ toca (a rota responde 200 e o `Audio` fica sem erro);
  - ★ persiste depois de recarregar;
  - o console fica sem erros.

  Depois, remover o pacote de teste: apagar a pasta e a entrada do catálogo (por script que reescreve o `catalogo.json` sem ele).
- [ ] **Passo 5: commit** `Aba Efeitos: biblioteca com busca, ouvir e favoritos`.

### Tarefa 7: Pacote real, documentação e push

- [ ] **Passo 1:** com a parte 1 da Sonniss 2024 em `~/Downloads`, importar pela aba (ou pela API).
  - Registrar arquivos, fatias, pulados e o tempo.
  - Conferir a contagem por categoria e 20 sons ao acaso (nome × categoria) e anotar a taxa de acerto no ledger.
- [ ] **Passo 2:** na aba, buscar "click", "whoosh" e "paper", ouvir, favoritar e recarregar.
- [ ] **Passo 3:** atualizar o `CURSO.md` com uma seção nova "Biblioteca de efeitos (Sonniss)", explicando onde baixar, a licença, como importar e como buscar. Atualizar o `COMO-USAR.md` com uma linha da aba Efeitos.
- [ ] **Passo 4:** rodar as checagens de segurança das Restrições globais. Commit `Docs: biblioteca de efeitos` e `git push origin main`.
