# Sonorizar um vídeo (parte 2 do sistema de efeitos) — design

Data: 2026-10-18 · Estado: aguardando revisão

## Objetivo

Na aba **🔊 Efeitos**, o usuário abre **qualquer vídeo da Mídia**. O estúdio:

- analisa o vídeo (itens, cortes e a fala);
- **sugere sons da biblioteca catalogada** (parte 1, Sonniss);
- mostra uma **linha do tempo de arrastar**, com prévia sincronizada, para ajustar;
- **exporta um MP4** (vídeo + áudio original + efeitos, −14 LUFS) de volta para a Mídia.

### Decisões tomadas com o usuário

- Vale para **os dois tipos de vídeo**:
  - animações do estúdio, pelos itens que entram e saem;
  - vídeos de câmera falando, pelos cortes, movimentos e ênfases da fala.
- A linha do tempo é **própria, dentro da aba Efeitos**. Não usa o Editor, para não poluir o Editor nem a Mídia com dezenas de sons curtos.
- Os sons vêm **só da biblioteca real**, sem gerar nada na ElevenLabs. O Claude só **lê texto** (a transcrição) para marcar as ênfases; a licença da Sonniss proíbe IA no áudio.

## Visão geral

```
Mídia (vídeo) ──abrir──► sonorização salva (dados/efeitos-sonorizacoes/<id>.json)
                              │ sem análise ainda?
                              ▼  job "Analisando o vídeo"
     detector de itens (lib/eventos-visuais.js) + cortes (lib/analise-video.js)
     + fala: Whisper (lib/transcricao.js) → Claude (só texto) → ênfases
                              │
          montarKit (biblioteca: papel → categorias → 1–3 sons, favoritos/macios primeiro)
          sugerirClipes (eventos/ênfases/cortes → papel → som do kit, revezando, densidade)
                              │
     aba Efeitos › Sonorizar: vídeo + faixa de efeitos (blocos arrastáveis) + biblioteca lateral
                              │ salvar automático (PATCH)
                              ▼  job "Exportando"
     faixa de efeitos somada em JS (lib/faixa-itens.js) + áudio original
     → aplicarAudioNoVideo (efeitos abaixam sob a fala, master −14 LUFS) → Mídia "<nome> (com efeitos)"
```

## Unidades

### 1. `lib/sonorizar/papeis.js` — papel de cada momento (puro)

- **Papéis e as categorias da biblioteca que servem a cada um** (em ordem de preferência), na constante `PAPEIS`:

  | Papel | Categorias | Duração máx. do som | Volume padrão |
  |---|---|---|---|
  | `item-pequeno` | clique, ui, tique | 0,6 s | 0,7 |
  | `item-grande` | impacto, grave | 1,5 s | 0,9 |
  | `saida` | swish, whoosh | 1,5 s | 0,6 |
  | `movimento` | whoosh, swish | 1,5 s | 0,6 |
  | `digitacao` | teclado, tique, clique | 0,4 s | 0,5 |
  | `corte` | whoosh, impacto | 1,5 s | 0,8 |
  | `enfase:<categoria>` | a categoria sugerida (impacto, brilho, whoosh, grave, riser, clique) | 3 s | 0,9 |

- `papelDoEvento(evento) → papel | null`, para eventos do detector:
  - `entra` com `digitacao` → `digitacao`;
  - `entra` com área ≥ 2% → `item-grande`;
  - `entra` menor → `item-pequeno`;
  - `sai` → `saida`;
  - `move` → `movimento`;
  - `corte` → `corte`.

### 2. `lib/sonorizar/sugerir.js` — kit e sugestões (puro)

- **`montarKit(sons, { favoritos: Set, papeis: string[] }) → { kit: { [papel]: Som[] }, faltando: string[] }`**
  - Para cada papel, os candidatos são os sons das categorias do papel com duração ≤ a máxima.
  - Pontuação: `10·favorito + 3·macio + 1·(é golpe/fatia) − duracao`.
  - Ficam os **3 melhores**, sem repetir o mesmo arquivo de origem.
  - Um papel sem nenhum candidato entra em `faltando`, com o rótulo da primeira categoria do papel.
- **`sugerirClipes({ eventos, cortes, enfases, kit, intensidade, duracao }) → Clipe[]`**, com `Clipe = { uid, somId, t, volume, papel }`.
  - **Momentos:**
    - eventos do detector que têm papel;
    - os `cortes` da análise (tempo em segundos), papel `corte`;
    - as `enfases` (`{ t, categoria }`), papel `enfase:<categoria>`.
  - **Fusão:** momentos a menos de 60 ms viram um. Fica o de maior prioridade: ênfase > corte > item-grande > os demais.
  - **Densidade máxima por segundo:** sutil 2, equilibrado 3,5, intenso 5. A cota é acumulada por segundo, como em `mapa-itens`. Os de maior prioridade ficam.
  - **Som:** cada papel reveza entre os sons do seu kit (1º, 2º, 3º, 1º…). Um papel sem kit não gera clipe.
  - **Cortes duplicados:** os `cortes` da análise que ficam a menos de 0,3 s de um evento `corte` do detector são descartados.
  - **Riser:** termina no momento. O clipe começa em `max(0, t − duração do som)`.
  - `volume` = o volume padrão do papel. O `uid` é único por clipe.

### 3. `lib/sonorizar/enfases.js` — ênfases da fala (Claude, só texto)

- **`pedirEnfases({ frases, palavras, duracao, perguntar = perguntarClaude, sinal }) → { t, categoria, motivo }[]`.**
  - Envia as frases com tempo e as palavras com o tempo de cada uma.
  - Pede **momentos de ênfase**: números e preços, o nome do produto, "agora/hoje/grátis", viradas, a chamada final. Cada um vem com uma categoria entre `impacto, brilho, whoosh, grave, riser, clique`.
  - O `t` é o início da palavra.
- **Normalização:**
  - `t` limitado a [0, duracao];
  - categoria fora da lista → descartada;
  - no máximo **1 ênfase a cada 2 s** (fica a primeira);
  - timeout de 3 min.
- Uma falha devolve `[]` (a sonorização segue sem ênfases).

### 4. `lib/sonorizar/sessao.js` — sonorização salva

- **Formato do arquivo** `dados/efeitos-sonorizacoes/<id>.json` = `{ id, midia, duracao, largura, altura, temAudio, criado, atualizado, intensidade, volumeEfeitos, analise, clipes }`:
  - `analise = { versao: 1, eventos, cortes, fala: { frases, palavras } | null, enfases }`;
  - `intensidade` começa em `'equilibrado'`;
  - `volumeEfeitos` começa em `0.8`.
- **Funções:**
  - `idDaMidia(nome) → string`: sha1 curto (12 caracteres) do nome do arquivo na Mídia;
  - `lerSonorizacao(pasta, id) → objeto | null`;
  - `gravarSonorizacao(pasta, s)`: grava atômica (`.tmp` + rename) e atualiza `atualizado`;
  - `validarClipes(clipes, { duracao, idsValidos: Set }) → Clipe[]`: descarta `somId` desconhecido, limita `t` a [0, duracao] e `volume` a [0, 1,5].

### 5. `lib/sonorizar/exportar.js` — montar e exportar

- **`montarFaixaEfeitos({ clipes, sons: Map<id, Som>, raiz, duracao, volumeEfeitos, saida }) → Promise<string>`.**
  - Cada som é lido **uma vez** com `lerPcm`. Uma fatia é lida com `af = atrim=start:end`.
  - A soma usa `somarFaixa`, com `volume·volumeEfeitos` e pan 0, e é gravada com `gravarWav`.
- **`exportarSonorizado({ video, temAudio, faixaEfeitos, saida, pastaTemp }) → Promise<void>`.**
  - Com áudio, o áudio original é extraído para WAV e o estúdio chama `aplicarAudioNoVideo(video, [{ arquivo: original, tipo: 'voz', volume: 1 }, { arquivo: faixaEfeitos, tipo: 'efeitos', volume: 1 }], saida)`. Assim os efeitos abaixam sob a fala, e o master sai em −14 LUFS.
  - Sem áudio, só a faixa de efeitos.
  - Os temporários são apagados.

### 6. `lib/biblioteca/cache.js` — catálogo compartilhado

- `obterCatalogo(raiz) → { catalogo, porId }`, com cache em memória.
- `invalidarCatalogo()` é chamado ao fim de cada importação.
- `rotas-efeitos.js` passa a usar esse cache em vez do seu próprio.

### 7. `lib/rotas-sonorizar.js` — API

| Rota | Faz |
|---|---|
| `GET /api/sonorizar/videos` | vídeos da Mídia (`tipo: 'video'`) com miniatura, duração e `clipes` (quantos sons já colocados, se existe sonorização) |
| `POST /api/sonorizar/abrir` `{ midia }` | cria ou carrega a sonorização. Sem análise, inicia o job "Analisando o vídeo", que no fim monta o kit e as sugestões. Devolve `{ sessao, job? }` |
| `GET /api/sonorizar/:id` | a sonorização + `sons` (para cada `somId` usado: nome, categoria, duração e onda) + `faltando` |
| `PATCH /api/sonorizar/:id` `{ clipes?, intensidade?, volumeEfeitos? }` | valida (`validarClipes`) e grava |
| `POST /api/sonorizar/:id/sugerir` `{ intensidade }` | refaz kit + sugestões a partir da análise salva (substitui os clipes) |
| `POST /api/sonorizar/:id/exportar` | job "Exportando com efeitos". Monta a faixa, exporta para a Mídia (`nomeLivre`) e registra com `registrarMidia(..., { origem: 'efeitos', titulo: '<título> (com efeitos)' })` |

- **Job de análise:**
  1. O vídeo é lido de `PASTAS.midia`.
  2. Eventos: `quadrosDoVideo` + `detectarEventos`.
  3. Cortes: `analisarVideo` numa pasta temporária, apagada depois.
  4. Fala: se `temAudio`, `transcrever` e depois `pedirEnfases`.
  5. Cada etapa que falha é registrada no job e pulada.
- **Biblioteca vazia:** `abrir` responde 409 "Importe uma biblioteca de efeitos primeiro."

### 8. A aba Efeitos — modo "Sonorizar vídeo" (`public/app.js`, `index.html`, `style.css`)

- **Topo da aba:** alternância **📚 Biblioteca | 🎬 Sonorizar vídeo**.
- **Lista:** grade de vídeos da Mídia (miniatura, título, duração, "N sons" quando já existe sonorização). Clicar abre o vídeo.
- **Editor de sonorização:**
  - **Em cima:**
    - o `<video>` (de `/arquivos/midia/<nome>`) com play/pause e tempo;
    - as chips de intensidade, **↻ Sugerir de novo** (pede confirmação, porque substitui os sons) e **Exportar MP4**;
    - o volume geral dos efeitos;
    - os avisos de `faltando` ("sua biblioteca não tem *Teclado* — importe outra parte da Sonniss").
  - **Ao lado:** a biblioteca compacta, com busca e categoria. Cada linha tem ▶ e é **arrastável** (`draggable`, `dataTransfer` = `somId`).
  - **Embaixo:**
    - a régua de tempo e a **faixa de efeitos**: cada clipe é um bloco com cor e ícone por categoria, posição `t/duracao`, largura pela duração do som (mínimo 6 px);
    - uma agulha (playhead) que segue o vídeo; clicar na régua posiciona o vídeo;
    - zoom de 1× a 8×, com rolagem horizontal.
  - **Interações:**
    - arrastar um bloco muda `t`;
    - soltar um som da biblioteca na faixa cria um clipe em `t` (volume 0,8, papel `manual`);
    - clicar num bloco seleciona e mostra o inspetor: nome, ▶, volume, **Trocar** (a biblioteca filtra pela mesma categoria e cada linha ganha "usar este"), **Remover**;
    - **Delete** remove o selecionado;
    - **Espaço** dá play/pause no vídeo.
  - **Salvar:** automático, com 600 ms de espera depois da última mudança (PATCH).
- **Prévia sincronizada (Web Audio):**
  - Os buffers de cada `somId` são baixados de `/api/efeitos/ouvir/:id`, decodificados uma vez e guardados em cache.
  - No play, os clipes com `t ≥ currentTime` são agendados para `ctx.currentTime + (t − video.currentTime)`, com ganho `volume·volumeEfeitos`.
  - Pause, seek ou edição param tudo e reagendam.
  - O áudio do vídeo toca pelo próprio `<video>`.

## Erros e limites

- **Biblioteca vazia:** a aba leva ao modo Biblioteca, com a mensagem de importar.
- **Detecção, cortes ou fala falham:** a análise segue com o que deu certo, e o job lista o que foi pulado.
- **Vídeo sem itens nem fala nem cortes:** zero sugestões e um aviso "Nada detectado — arraste sons da biblioteca para a faixa".
- **Um `somId` que sumiu da biblioteca** (pacote removido): o clipe é descartado ao abrir, e o estúdio avisa.
- **Exportação que falha:** os temporários são apagados e o job mostra o erro. Nada é registrado na Mídia.
- **Vídeo longo:** a faixa soma em JS (rápido até 600 sons/120 s, já medido), e a análise reusa o detector.

## Testes

- **`papeis`:** `papelDoEvento` para cada tipo de evento e para a área de 2%.
- **`sugerir`:**
  - o kit prefere favorito, depois macio, depois golpe;
  - o kit respeita a duração máxima e não repete o arquivo de origem;
  - categoria ausente vai para `faltando`;
  - o revezamento 1-2-3-1;
  - a fusão de momentos a menos de 60 ms com prioridade;
  - a densidade sutil (≤ 2/s);
  - papel sem kit não gera clipe.
- **`enfases`** (stub do Claude):
  - normaliza `t` e categoria;
  - limita a 1 a cada 2 s;
  - falha → `[]`.
- **`sessao`:**
  - `idDaMidia` é estável;
  - grava de forma atômica;
  - `validarClipes` descarta id desconhecido e limita `t` e volume.
- **`exportar`:**
  - a faixa de efeitos tem a duração certa, com o pico no tempo do clipe;
  - integração com um vídeo sintético de 3 s com tom: o MP4 sai com −14 ± 1 LUFS;
  - um vídeo sem áudio também exporta.
- **Rotas** (express de teste, catálogo temporário):
  - `abrir` com biblioteca vazia → 409;
  - PATCH valida;
  - `sugerir` substitui os clipes.
- **Real, no navegador do app:**
  - uma animação renderizada da Mídia e um vídeo de câmera falando;
  - conferir as sugestões, arrastar, trocar e adicionar da biblioteca;
  - a prévia toca sincronizada;
  - exportar, ouvir o resultado e medir os LUFS.

## Fora do escopo

- Mais de uma faixa de efeitos.
- Fades, pitch ou pan por clipe.
- Sonorizar áudio ou imagem.
- Levar a sonorização para o Editor.
- Gerar sons com IA.
