# Biblioteca de efeitos (parte 1 do sistema de efeitos sonoros) — design

Data: 2026-10-17 · Estado: aguardando revisão

## Objetivo

O dono do estúdio quer um sistema focado **só em efeitos sonoros reais de biblioteca**. Ele achou fracos os efeitos gerados pela ElevenLabs.

Esta é a parte 1. Ela entrega:

- a importação de pacotes profissionais (começando pelo **Sonniss GDC**);
- um **catálogo** que entende cada som;
- uma aba nova **"Efeitos"** para buscar, ouvir e favoritar.

A **parte 2** é outra spec: abrir qualquer vídeo da Mídia, detectar itens e momentos, sugerir sons da biblioteca, montar uma linha do tempo de arrastar e exportar.

### Decisões tomadas com o usuário

- **Formato:** uma aba nova "Efeitos". Na parte 2 ela vai servir para **qualquer vídeo da Mídia**.
- **Divisão:** primeiro a biblioteca (esta spec), depois o uso no vídeo.
- **Como o estúdio entende cada som:**
  - **nome e metadados do arquivo**, mais **medidas do áudio feitas no PC**;
  - **regras e o Claude só com texto** para classificar.
  - Não usar IA que "ouve" o áudio: a licença da Sonniss proíbe uso em IA/ML.

### Licença (Sonniss GDC)

- **Permitido:** uso comercial, sem crédito. Editar e fatiar os sons também é permitido.
- **Proibido:** redistribuir os sons, originais ou editados.
- **Consequências para o estúdio:**
  - Os sons e o catálogo ficam em `dados/`, que nunca vai para o GitHub.
  - O CURSO orienta cada comprador a baixar o próprio pacote.
  - O catálogo usa só leitura de metadados e medidas simples de sinal, sem treinar modelo nenhum.

## Visão geral

```
.zip (Downloads) ou pasta ──importar──► dados/biblioteca-sfx/<pacote>/… (pastas originais)
                                             │
                                  indexar (job com progresso)
          ffprobe (descrição embutida) · nome UCS · PCM 60 s → medidas + fatias + mini-onda
                                             │
                     regras (UCS + palavras) → categoria; restante → Claude (texto, em lotes)
                                             │
                          dados/biblioteca-sfx/catalogo.json  (+ dados/efeitos-favoritos.json)
                                             │
                     API /api/efeitos/* ──► aba "Efeitos": categorias, busca, filtros, ▶, ★
```

## Unidades

### 1. `lib/biblioteca/ucs.js` — nome no padrão UCS (puro)

- `lerNomeUcs(nomeArquivo) → { catId, familia, descricao, criador } | null`
  - O padrão UCS é `CatID_Descrição_Criador_Fonte.wav`, por exemplo `WHSHAir_Fast Swoosh Short_ACME_SFX.wav`.
  - `catId` é o primeiro bloco, desde que comece por letras maiúsculas.
  - `familia` são as maiúsculas iniciais do CatID (ex.: `WHSH`, `UI`, `PAPR`, `DSGN`).
  - Fora do padrão, devolve `null`.

### 2. `lib/biblioteca/classificar.js` — categoria do estúdio

- **Categorias do estúdio:**
  - Lista `CATEGORIAS` = `clique`, `tique`, `teclado`, `papel`, `ui`, `whoosh`, `swish`, `impacto`, `grave`, `riser`, `glitch`, `brilho`, `ambiente`, `foley`, `outros`.
  - Cada uma tem rótulo e ícone para a tela.
- **`categoriaPorRegras({ ucs, nome, descricao }) → { categoria, tags } | null`.** A primeira regra que casa vence, nesta ordem:
  1. **CatID UCS:** cada regra compara o **início do CatID**. `UI` casa com `UIClick`; `DSGNImpt` casa só com os CatIDs `DSGNImpt…`, não com a família `DSGN` inteira.
     - `UI` → `ui` (ou `clique` se o texto tiver *click*);
     - `WHSH` → `whoosh`;
     - `SWSH` → `swish`;
     - `PAPR` → `papel`;
     - `IMPT` / `DSGNImpt` / `HIT` → `impacto`;
     - `BOOM` / `DSGNBoom` / `SUB` → `grave`;
     - `RISR` / `DSGNRise` → `riser`;
     - `GLTCH` / `DSGNGlch` / `ELEC` com *glitch* → `glitch`;
     - `AMB` → `ambiente`;
     - `MAGC` / `DSGNShmr` → `brilho`;
     - `FOLY` / `CLTH` / `OBJ` → `foley`.
  2. **Palavras no nome ou na descrição, em inglês e português:**
     - *typewriter / keyboard / keystroke / key press* → `teclado`;
     - *click / button / switch* → `clique`;
     - *tick / tock / clock* → `tique`;
     - *paper / pen / pencil / marker / page* → `papel`;
     - *whoosh / swoosh / swipe / pass-by* → `whoosh`;
     - *impact / hit / punch / slam* → `impacto`;
     - *boom / sub drop / low hit* → `grave`;
     - *riser / rise / build* → `riser`;
     - *glitch / data / stutter* → `glitch`;
     - *shimmer / sparkle / magic / twinkle* → `brilho`;
     - *ambience / room tone / atmos* → `ambiente`.
- **Tags em português:** vêm de um dicionário curto (ex.: *metal* → metal, *wood* → madeira, *soft* → suave, *heavy* → pesado).
- **`classificarComClaude(itens: {id, nome, descricao}[], { modelo, sinal }) → Map<id, { categoria, tags }>`.**
  - Recebe só os itens sem regra, em **lotes de 150**, com o modelo `claude-sonnet-5-5` (rápido).
  - Pede de volta um JSON com `categoria` (da lista) e até 5 tags em português.
  - Uma resposta inválida ou um lote que falha deixa esses itens em `outros`, e a importação continua.

### 3. `lib/biblioteca/medidas.js` — sinal (puro, testável sem ffmpeg)

- **`medirSom(pcm: Float32Array, sr) → { ataqueMs, brilho, aspereza, pico, rms }`**, sobre o sinal mono.
  - `ataqueMs`: tempo de 10% a 90% do pico do envelope (janela de 5 ms).
  - `brilho`: fração da energia acima de 4 kHz, com passa-alta biquad.
  - `aspereza`: fração da energia na faixa de 2–5 kHz, com passa-faixa biquad. É a mesma medida que guiou o "quase ASMR".
  - `pico` e `rms` em dBFS.
- **`fatiar(pcm, sr) → { inicio, fim }[]`** em segundos.
  - Separa onde o envelope fica **abaixo de −45 dB em relação ao pico por ≥ 150 ms**.
  - Descarta fatias com menos de 40 ms.
  - Deixa 5 ms de margem antes e 30 ms depois de cada fatia.
  - Só fatia arquivos de até **60 s** que resultem em **≥ 2 fatias**. Fora disso, devolve `[]`.
- **`miniOnda(pcm, n = 48) → number[]`**: o pico por bloco, de 0 a 1, para desenhar a onda na lista.
- O macio/áspero da tela é derivado: `macio = 1 − clamp((aspereza − 0,05) / 0,25)`, de 0 (áspero) a 1 (macio).

### 4. `lib/biblioteca/catalogo.js` — indexar e buscar

- **`indexarPacote({ pasta, pacote, aoProgresso, sinal }) → Som[]`.** Percorre os áudios (`wav`, `mp3`, `flac`, `ogg`, `aif`/`aiff`). Para cada arquivo:
  1. `ffprobe` lê a duração e a descrição embutida (tags `comment` / `description` / `title`).
  2. O ffmpeg decodifica para PCM mono a 48 kHz, **no máximo os primeiros 60 s**.
  3. Faz as medidas, a mini-onda e as fatias.

  Um arquivo ilegível é pulado e contado.

  Cada som vira `Som = { id, pacote, arquivo, inicio, fim, pai, nome, descricao, ucs, duracao, medidas, macio, onda, categoria, tags }`:
  - `arquivo` é o caminho relativo a `dados/biblioteca-sfx`;
  - o `id` é o hash curto de `arquivo#inicio`.

  Cada fatia vira um `Som` próprio, com `pai` = id do arquivo, a mesma categoria e o nome "… (golpe N)". O arquivo inteiro continua no catálogo.
- **`buscar(sons, { q, categoria, duracao: 'curto'|'medio'|'longo', macio: 'macio'|'aspero', favoritos: Set, soFavoritos, pagina, porPagina = 60 }) → { total, itens }`.**
  - Duração: curto < 0,6 s, médio de 0,6 a 3 s, longo > 3 s.
  - Macio: `macio ≥ 0,6`. Áspero: `macio ≤ 0,4`.
  - **Texto:** todas as palavras de `q` (sem acento, minúsculas) precisam aparecer em `nome + descricao + tags + rótulo da categoria`.
  - **Ordem:** com `q`, a soma de acertos no nome vale 2 e na descrição ou nas tags vale 1. Sem `q`, favoritos primeiro e depois o nome.
- **`contarCategorias(sons) → { [categoria]: n }`.**
- **Persistência:** `dados/biblioteca-sfx/catalogo.json` = `{ versao: 1, pacotes: [{ id, nome, pasta, importado, arquivos, fatias, pulados }], sons: Som[] }`.
  - É gravado ao fim de cada pacote.
  - Fica em memória no servidor, recarregado depois de cada importação.

### 5. `lib/biblioteca/importar.js` — zips e espaço

- **`listarZips(dir = ~/Downloads) → { nome, caminho, tamanho }[]`.**
  - Lista os `.zip` com mais de 10 MB, os mais novos primeiro.
  - Os que têm "sonniss" ou "gdc" no nome vêm marcados como `sonniss: true`.
- **`espacoLivre(dir) → bytes`**, via `fs.statfs`.
- **`extrairZip(zip, destino, { sinal })`:**
  - No Windows usa `%SystemRoot%\System32\tar.exe -xf` (bsdtar, que lê zip).
  - Em outros sistemas usa `unzip -q`.
  - Se o espaço livre for **menor que 1,1 × o tamanho do zip**, recusa a importação com a mensagem "Espaço insuficiente: precisa de X GB livres, há Y GB".
- **Nome do pacote:** vem do nome do zip sem a extensão. Um zip já importado (mesmo nome de pacote no catálogo) é recusado com a mensagem "Esse pacote já está na biblioteca".

### 6. `lib/rotas-efeitos.js` — API

| Rota | Faz |
|---|---|
| `GET /api/efeitos/zips` | `listarZips()` + espaço livre em `dados/` |
| `POST /api/efeitos/importar` `{ caminho, apagarZip }` | job "Importando pacote": extrai (de um zip) ou indexa direto (de uma pasta) → classifica → grava o catálogo → apaga o zip se `apagarZip`. Mensagens em português com a contagem |
| `GET /api/efeitos/categorias` | contagem por categoria + total + pacotes |
| `GET /api/efeitos/sons?q=&categoria=&duracao=&macio=&fav=&pagina=` | `buscar(...)` |
| `GET /api/efeitos/ouvir/:id` | o arquivo inteiro (`sendFile`). Uma fatia é recortada com ffmpeg uma vez para `dados/biblioteca-sfx/.cache/<id>.wav` e servida dali |
| `POST /api/efeitos/favorito` `{ id, ativo }` | grava em `dados/efeitos-favoritos.json` |

- **Caminhos:** todo caminho recebido é validado. `caminho` tem de ser um `.zip` existente em `~/Downloads` ou uma pasta escolhida pelo usuário, e nunca pode ficar dentro de `dados/`. Um `id` desconhecido devolve 404.

### 7. A aba "Efeitos" (`public/efeitos-ui.js` + `index.html` + `style.css`)

- **Navegação:** um botão `🔊 Efeitos` depois de "🎬 Cenas IA", seguindo o padrão de `kie-ui.js`.
- **Biblioteca vazia:**
  - um cartão explicando a Sonniss (link para `sonniss.com/gameaudiogdc`, resumo da licença: uso comercial livre, não redistribuir);
  - a lista de zips encontrados em Downloads, com o botão **Importar**;
  - a caixa "apagar o .zip depois" marcada;
  - o campo "ou importar uma pasta" (o caminho).
- **Com biblioteca, coluna da esquerda:** chips de categoria com ícone e contagem, a busca, os filtros (Curto/Médio/Longo, Macio/Áspero, ★ Favoritos) e "＋ Importar outro pacote".
- **Com biblioteca, lista:** cada linha mostra a mini-onda (SVG a partir de `onda`), ▶, ★, o nome, o pacote, a duração, as tags e um selo "golpe N" nas fatias.
  - Clicar na linha toca o som.
  - **Espaço** toca ou para o selecionado; **↑/↓** navegam.
  - A paginação é "Carregar mais".
- **Importação em andamento:** uma barra com o progresso e a última mensagem do job. Ao terminar, mostra "N sons (M fatias) importados, K pulados".

## Erros e limites

- **Zip corrompido ou extração que falha:** o job dá erro com a mensagem do tar, e a pasta parcial é removida.
- **Disco cheio:** a importação é recusada antes de começar (§5).
- **Classificação pelo Claude que falha:** os itens ficam em `outros`, e a importação conclui mesmo assim.
- **Muitos arquivos:** o pacote completo tem dezenas de milhares de sons. O catálogo é um JSON único, e a busca é em memória, que dá conta de ~50 mil itens. A tela pagina de 60 em 60.

## Testes

- **`ucs`:**
  - `WHSHAir_Fast Swoosh_ACME_SFX.wav` → família `WHSH`;
  - um nome comum → `null`.
- **`classificar`:**
  - família `UI` + *click* → `clique`;
  - *typewriter keys* → `teclado`;
  - *paper rip* → `papel`;
  - um nome sem nada → `null`;
  - o lote do Claude com resposta inválida → `outros`, usando um stub da função de pergunta.
- **`medidas`:**
  - 3 cliques sintéticos separados por 300 ms de silêncio → 3 fatias nos tempos certos (±10 ms);
  - um ruído contínuo → `[]`;
  - um arquivo de 90 s → `[]`;
  - um ruído com passa-alta → `brilho` maior que um seno de 200 Hz;
  - um seno de 3 kHz → `aspereza` maior que um seno de 300 Hz;
  - um ataque instantâneo → `ataqueMs` < 10;
  - um fade de 200 ms → `ataqueMs` > 100.
- **`catalogo`:**
  - a busca por "click metal" exige as duas palavras;
  - categoria + curto + macio filtram juntos;
  - os favoritos vêm primeiro;
  - a paginação funciona;
  - a contagem por categoria bate.
- **Integração (`INTEGRACAO=1`):**
  1. criar um zip com 3 WAVs sintéticos (um deles com 3 golpes) via bsdtar;
  2. importar;
  3. o catálogo deve ter 3 arquivos + 3 fatias, e o zip deve ser apagado quando pedido.
- **Real:**
  - importar a parte 1 da Sonniss 2024 baixada pelo usuário;
  - conferir as contagens por categoria e uma amostra da classificação;
  - na aba, buscar, ouvir (▶ e Espaço) e favoritar;
  - o console do navegador deve ficar sem erros.

## Fora do escopo (parte 2)

- Abrir um vídeo da Mídia na aba Efeitos.
- Detectar itens e momentos e sugerir sons.
- A linha do tempo de arrastar.
- Exportar o MP4.
- Trocar a fonte da aba Som pela biblioteca catalogada.
- Formatos de arquivo além de zip e pasta (rar, 7z).
