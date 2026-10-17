# Estúdio Opus — editor de vídeo local

Ferramenta local que transforma os **800+ modelos** do repositório
[awesome-opus5-5-videos](https://github.com/yihui-dev/awesome-opus5-5-videos) em vídeos MP4 seus.

O repositório não tem vídeos: são **prompts** que criadores deram ao Claude Opus 5.5 para ele escrever
animações em código (HTML, Canvas, SVG, Three.js, GSAP, shaders). O estúdio faz o caminho completo:

```
Modelo (prompt)  →  Claude gera a animação  →  Render para MP4  →  Editor (cortes, texto, música)  →  MP4 final
```

## Como abrir

Dê dois cliques em **`Iniciar Estudio.bat`**: ele abre o estúdio em http://127.0.0.1:4777.
Deixe a janela preta aberta enquanto usa o estúdio.

Pelo terminal: `npm start` dentro desta pasta.

## As três abas

### 1. Modelos
- Busca em todos os prompts, com filtro por categoria (Motion graphics, Explicativos, Cenas 3D, Jogos e
  interativos) e por tecnologia (canvas, threejs, gsap, shader…).
- Clique num card para ver o prompt original e os links do vídeo original e do remake no Skillry.
- **💡 Sua ideia → ✦ Gerar prompt**: escreva a ideia em poucas palavras e o Claude escreve um prompt completo, com cenas, tempos, paleta e gancho, no estilo do modelo escolhido. Dá para desfazer. **✦ Sugerir instruções extras** propõe gancho, CTA, áreas seguras do Reels e legibilidade; escreva no campo o que você quer (ex.: "CTA para comprar no link") antes de clicar.
- **Usar este modelo**: edite o prompt, informe o tema/marca (ex.: *Minha Marca — produto*), os textos,
  o formato (9:16, 4:5, 1:1 ou 16:9), a duração, o idioma e a paleta, e clique em **Gerar animação com Claude**.
- "⟳ Atualizar repo" roda `git pull` para buscar modelos novos.

### 2. Projetos
Cada geração vira um projeto com pré-visualização ao vivo.
- **Refinar**: peça mudanças em português ("textos maiores", "troque as cores"…). Cada refinamento vira uma versão nova.
- **Renderizar**: grava o MP4. Resolução cheia, 2/3 ou rascunho; 24/30/60 fps; duração; pular início.
- **Versões**: volte para qualquer versão anterior.
- **Código**: edite o HTML na mão e salve como versão nova.
- **Prompt**: veja o que foi pedido e gere de novo do zero (dá para trocar o modelo do Claude).

#### Aba Som (voz + efeitos)
O Claude lê o **código da animação** para descobrir quando cada coisa acontece na tela e sincronizar o som.

**Voz / locução**
1. Escolha o motor:
   - **Piper**: grátis, offline, vozes masculinas pt-BR.
   - **Windows**: grátis, offline, voz feminina Maria.
   - **ElevenLabs**: qualidade de estúdio, usa os créditos da sua conta.
2. Escolha a voz, a velocidade e o tom, e clique em **Escrever roteiro com Claude**. As falas vêm com o segundo em que cada uma entra.
3. Edite as falas se quiser e clique em **Gerar voz**. Cada fala mostra a duração; aparece ⚠ quando ela invade a fala seguinte.

**Meu áudio gravado** (motor "🎤 Meu áudio gravado"):
1. Envie a sua locução (MP3, WAV, M4A ou até um vídeo). O estúdio transcreve offline com o **Whisper**, com o tempo de cada palavra. Na primeira vez ele baixa o modelo (~480 MB).
2. **Atraso do áudio**: um valor positivo empurra a fala para depois; um negativo corta o começo da gravação.
3. **Sincronizar a animação com o meu áudio**: o Claude refaz a linha do tempo para cada texto e cena entrarem quando você fala aquilo, e a duração do vídeo vira a do áudio.
4. Os refinamentos seguintes mantêm a sincronia.

Também dá para começar já com a locução: no **Usar este modelo**, envie o áudio em **⬆ Enviar meu vídeo** (caixa roxa no topo do formulário) e a animação já nasce sincronizada.

**Animação por cima do seu vídeo:** clique em **🎬 Animar meu vídeo** (aba Projetos) ou, no formulário de criação, em **⬆ Enviar meu vídeo** (caixa roxa no topo), e escolha um **vídeo seu falando**. O estúdio assiste ao vídeo (lê a sua fala com o tempo de cada palavra e olha os quadros), escreve o prompt de uma animação que entra **por cima** dele e ajusta formato e duração. Revise o prompt e gere: a prévia mostra a animação sobre o seu vídeo, e o MP4 final sai com o seu vídeo, a animação e o seu áudio original (vai para a Mídia do Editor).

**ElevenLabs**: o modelo padrão é o **Eleven v4**. Com a permissão **Voices (Read e Write)** na chave, a lista mostra as **suas vozes** e as **vozes brasileiras da Voice Library** com o nome exato do site, busca por nome e ▶ amostra. A primeira vez que você usa uma voz da biblioteca, ela é adicionada à sua conta e ocupa um slot de voz do seu plano.

**Sonoplastia (efeitos sonoros):** a IA **assiste ao vídeo** (quadros, cortes, movimento, flashes, locução e código) e cria um desenho de som de cinema:
- impactos no quadro, risers que terminam na revelação e camadas;
- pan, reverb, silêncios dramáticos, ambiência e stinger final.

Escolha a fonte (**ElevenLabs** recomendado, síntese grátis ou sua biblioteca), o estilo e a intensidade. Depois clique em **👁 Assistir ao vídeo e desenhar o som** e em **🔊 Gerar sonoplastia**. Cada som pode ser ajustado (tempo, alinhamento, volume, pan, reverb), ouvido isolado (▶) ou trocado por outra variação (↻). Cliques, teclas, digitação, caneta e papel saem sempre no tratamento "quase ASMR" (de perto, macios, secos e sem aspereza). Com a ElevenLabs, **cada item que entra, sai ou se move ganha um som** (notas afinadas em escala, "tum" nos itens grandes, swish nas saídas, tiques na digitação), a partir de um kit que a IA monta para o vídeo. O MP4 final sai em −14 LUFS.

**🔊 Assistir com som** toca a animação junto com a voz e os efeitos. No **Renderizar**, a caixa "incluir voz e efeitos" mixa tudo no MP4.

**Chave da ElevenLabs**: clique no **⚙** no topo e cole a chave criada em elevenlabs.io → Settings → API Keys. Ela fica salva só neste PC, em `dados/config.json`.

**CapCut**: a licença dos sons do CapCut só vale dentro do próprio CapCut. Para usar esses sons, exporte daqui com a caixa "incluir voz e efeitos" desmarcada (ou só com a voz) e faça a sonorização final no CapCut Pro, usando os sons marcados para uso comercial.

### 🎙 Estúdio de voz (aba Voz)
1. A IA assiste ao vídeo e escreve **3 opções de roteiro** e uma direção de voz.
2. Você edita o texto. Há contador de palavras e botões de tags de emoção.
3. A ElevenLabs grava a **locução inteira de uma vez**. Os controles são os do site: velocidade, estabilidade, similaridade e estilo.
4. Cada geração vira um **take** que você pode ouvir com o vídeo ou baixar.
5. **✔ Colocar no vídeo** transforma o take na voz do projeto. Depois, se quiser, **sincronize a animação** com essa voz.

### 🎬 Cenas IA (Kie.ai)
Vídeos realistas (pessoas falando, UGC, produto em cena) com Veo 3.1, Kling 3.0, Seedance 2.0 e Grok, pagos por geração na sua conta **kie.ai**. Cole a chave no topo da aba (fica só neste PC), escreva a ideia, gere o prompt com a IA, envie fotos se quiser e gere. O vídeo vai para a Mídia do Editor e o custo real aparece em cada resultado.

### ⚡ Opus Generator (grátis, no seu PC)
Vídeo com fala em português, som e música numa geração só, com o modelo aberto **MiniMax H3** rodando na sua placa de vídeo (via WanGP). A aba confere se a máquina aguenta (mínimo: placa de 6 GB, 24 GB de RAM, 35 GB livres), instala com o botão **⬇ Instalar** (Windows), abre o gerador e traz os vídeos da pasta `outputs` para a Mídia do Editor.

### 3. Editor (estilo CapCut)
**Timeline**: régua de tempo e **cabeçote** (a linha laranja). Clique ou arraste na régua para navegar. As faixas são:
🎬 Vídeo · 🅣 Textos · 💬 Legendas · 🎵 Trilha · 🎙 Áudios.

**Cortar e organizar**
- Arraste as **bordas** de um clipe para cortar o começo ou o fim.
- **✂ Dividir** (tecla **S**) corta no cabeçote. Funciona em clipes, textos e áudios.
- Arraste um clipe para mudar a ordem.
- Arraste textos e áudios para mudar quando entram; a borda direita muda a duração.
- **⧉ Duplicar** (Ctrl+D), **🗑 Excluir** (Delete), **↶ Desfazer / ↷ Refazer** (Ctrl+Z / Ctrl+Y).

**Painel do clipe (abas)**
- **Editar**: corte exato, "cortar começo/fim no cabeçote", volume, silenciar, separar o áudio numa faixa própria, fades. Em fotos e cartelas, também o movimento de zoom (Ken Burns).
- **Velocidade**: de 0,25× a 4×, sem mudar o tom da voz.
- **Filtros**: Vívido, P&B, Quente, Frio, Vintage, Contraste, Desbotado, Cinema, mais brilho, contraste e saturação. Dá para aplicar em todos os clipes.
- **Transição** (para o próximo clipe): 15 tipos (dissolver, pelo preto, flash, deslizar, cortina, círculo, zoom…), com duração ajustável. Também clicando no **+** entre dois clipes.
- **Texto**: um texto preso ao clipe.

**🅣 Textos** (tecla **T**): títulos, preços e chamadas com tempo livre. Têm 5 estilos (contorno, caixa preta, amarelo, neon, faixa vermelha), fonte, cor, tamanho, posição e animação de entrada (fade, pop, subir, digitar).

**💬 Legendas automáticas**: transcreve as falas da edição offline com o Whisper (a trilha não entra) e anima palavra por palavra.
- Estilos: destaque amarelo como no CapCut, destaque verde, caixa preta, karaokê e simples.
- Ajustes: tamanho, posição, MAIÚSCULAS e quantas palavras aparecem por vez.
- Dá para corrigir o texto de cada trecho no painel; clicar no tempo leva o cabeçote até ele.

**Atalhos**: Espaço tocar/pausar · S dividir · T texto · Delete excluir · ←/→ um quadro (Shift: 1s) · Home/End.

**Exportar MP4** junta tudo no formato escolhido: clipes, transições, filtros, velocidade, textos, legendas, trilha e áudios. Na prévia, as transições aparecem como um esmaecer; no MP4 sai a transição real.

### Vozes do ElevenLabs
Na aba Som, com o motor ElevenLabs, clique em **🎧 Escolher voz na biblioteca**. A lista segue o visual do site:
- abas **Explorar** (vozes brasileiras da Voice Library) e **Minhas vozes**;
- busca, filtro **Femininas / Masculinas**, ordem (em alta, mais usadas, mais recentes);
- clique no avatar para **ouvir a amostra** antes de escolher.

É preciso a permissão **Voices (Read e Write)** na chave da API.

## Onde ficam os arquivos

| Pasta | Conteúdo |
|---|---|
| `dados/midia/` | todos os MP4 (renders e exportações) e o que você importar |
| `dados/projetos/` | cada projeto, com todas as versões do HTML (`v1.html`, `v2.html`…) |
| `dados/posters/` | cache das capas dos modelos (baixadas uma vez) |
| `awesome-opus5-5-videos/` | o repositório clonado (prompts em `data/videos.json`) |

## Requisitos

- **Claude Code** instalado e logado (`claude` no terminal). A geração usa a sua assinatura (sem API key):
  o estúdio chama `claude -p` sem ferramentas e ignora variáveis `ANTHROPIC_*` para não cair em cobrança por API.
- **Google Chrome** ou **Microsoft Edge** (usado em modo invisível para o render).
- O ffmpeg já vem junto (pacotes `ffmpeg-static` e `ffprobe-static`).

## Como o render funciona

A animação roda num Chrome invisível com um **relógio virtual**: `requestAnimationFrame`, `performance.now`,
`Date.now`, timers e animações CSS seguem um tempo controlado pelo estúdio. A cada quadro o tempo avança
exatamente 1/fps, a tela é capturada e enviada ao ffmpeg. Por isso o vídeo sai fluido mesmo quando a
animação é pesada demais para rodar em tempo real. Resoluções menores mantêm a mesma composição e só reduzem os pixels.

## Limitações

- Alguns prompts originais usam ferramentas externas (Blender, After Effects, MCPs de imagem ou vídeo,
  arquivos de áudio). O estúdio pede ao Claude que recrie tudo em código no navegador, então o resultado é
  uma reinterpretação do original, não uma cópia.
- O áudio gerado pela animação não é gravado: a trilha entra pelo Editor.
- Vídeos e imagens externas dentro da animação podem não ficar sincronizados com o relógio virtual.
- Opus gera com mais qualidade; Sonnet é bem mais rápido para testar ideias.
