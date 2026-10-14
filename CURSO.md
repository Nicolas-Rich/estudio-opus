# 🎬 Curso Estúdio Opus — Vídeos com IA do zero ao MP4

Bem-vindo! Neste curso você aprende a usar o **Estúdio Opus** para criar vídeos animados com IA: anúncios, Reels, explicativos e vinhetas. Tudo roda no seu computador, com voz, efeitos sonoros, legendas automáticas e edição completa.

Não precisa saber programar. Cada módulo tem passos numerados e, no final, um ✅ **checklist** para você conferir se está tudo certo antes de seguir.

---

## Sumário

- [Módulo 0 — Como o Estúdio funciona](#módulo-0--como-o-estúdio-funciona)
- [Módulo 1 — Instalação passo a passo](#módulo-1--instalação-passo-a-passo)
- [Módulo 2 — Tour pela interface](#módulo-2--tour-pela-interface)
- [Módulo 3 — Seu primeiro vídeo a partir de um modelo](#módulo-3--seu-primeiro-vídeo-a-partir-de-um-modelo)
- [Módulo 4 — Ajustar a animação (refinar, versões e código)](#módulo-4--ajustar-a-animação-refinar-versões-e-código)
- [Módulo 5 — Som: voz, sua gravação e efeitos](#módulo-5--som-voz-sua-gravação-e-efeitos)
- [Módulo 6 — Renderizar o MP4](#módulo-6--renderizar-o-mp4)
- [Módulo 7 — Editor estilo CapCut](#módulo-7--editor-estilo-capcut)
- [Módulo 8 — Receitas prontas](#módulo-8--receitas-prontas)
- [Módulo 9 — Economizar tokens e créditos](#módulo-9--economizar-tokens-e-créditos)
- [Módulo 10 — Problemas comuns e soluções](#módulo-10--problemas-comuns-e-soluções)
- [Módulo 11 — Direitos, licenças e boas práticas](#módulo-11--direitos-licenças-e-boas-práticas)
- [Glossário](#glossário)

---

## Módulo 0 — Como o Estúdio funciona

### A ideia em uma frase
Você escolhe um **modelo** (um prompt de animação que já viralizou), adapta para a sua marca, e o **Claude escreve a animação em código**. O estúdio grava essa animação quadro a quadro em **MP4**, e você termina no **editor** com voz, música, legendas e cortes.

### O caminho de todo vídeo

```
1. Modelo ou ideia  →  2. Claude cria a animação  →  3. Som (voz + efeitos)
→  4. Render MP4  →  5. Editor (cortes, legendas, trilha)  →  6. Exportar e publicar
```

### O que custa o quê

| Parte | Custo |
|---|---|
| Gerar e refinar animações, escrever roteiro, mapear efeitos | Usa a sua **assinatura Claude** (Pro/Max), sem cobrança por API |
| Render, editor, legendas automáticas, vozes Piper e Windows, sua gravação | **Grátis**, roda no seu PC |
| Vozes e efeitos da ElevenLabs | Créditos da **sua conta ElevenLabs** |

### Por que "código"?
As animações do estúdio são páginas HTML animadas com Canvas, SVG, 3D e shaders, não vídeos gerados por IA. Por isso:
- os **textos ficam nítidos**, sem letras tortas;
- dá para **editar qualquer detalhe** (cor, preço, texto) sem gerar de novo;
- o mesmo projeto vira vídeo em **qualquer formato** (9:16, 1:1, 16:9).

✅ **Checklist:** você entendeu as 6 etapas e sabe o que é grátis e o que gasta.

---

## Módulo 1 — Instalação passo a passo

> Faça na ordem. Leva de 15 a 30 minutos na primeira vez.

### 1.1 Instale o Node.js
1. Acesse **https://nodejs.org** e baixe a versão **LTS**.
2. Instale clicando em "Next" até o fim, sem mudar nada.

### 1.2 Instale o Git
1. Acesse **https://git-scm.com/download/win** e baixe o instalador.
2. Instale com as opções padrão.

### 1.3 Instale o Claude Code e faça login
O Claude Code é o que gera as animações usando a sua assinatura Claude (é preciso o plano **Pro** ou **Max**).
1. Abra o **PowerShell**: menu Iniciar → digite "PowerShell" → Enter.
2. Cole e rode:
   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```
3. Feche e abra o PowerShell de novo, digite `claude` e Enter.
4. Siga o login no navegador com a sua conta Claude.
5. Quando aparecer a tela do Claude Code, digite `/exit` para sair.

### 1.4 (Recomendado) Instale o uv
O uv é usado para as **vozes grátis Piper** e para **transcrição e legendas automáticas**.

No PowerShell, rode:
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```
Depois feche e abra o PowerShell de novo.

### 1.5 Baixe o Estúdio Opus
- **Opção A (mais fácil):** na página do projeto no GitHub, clique em **Code → Download ZIP**. Extraia a pasta num lugar fácil, por exemplo `Documentos\estudio-opus`.
- **Opção B (com Git):**
  ```powershell
  git clone https://github.com/a2labsnutrition/estudio-opus.git
  ```

### 1.6 Abra o Estúdio
1. Entre na pasta e dê **dois cliques em `Iniciar Estudio.bat`**.
2. Na **primeira vez** ele instala as dependências (inclusive o ffmpeg) e baixa a biblioteca de modelos (800+). Leva alguns minutos.
3. O navegador abre em **http://127.0.0.1:4777**.
4. **Deixe a janela preta aberta** enquanto usa o estúdio. Fechar a janela desliga o estúdio.

> 💡 Sempre abra pelo `Iniciar Estudio.bat`. Se você fechar a janela no meio de uma geração, a geração é perdida.

✅ **Checklist:**
- no topo do estúdio aparece **"Claude 2.x ✓"** em verde;
- a aba **Modelos** mostra os vídeos com capa.

---

## Módulo 2 — Tour pela interface

O estúdio tem **3 abas** no topo e um **⚙** (configurações) no canto direito.

### Aba Modelos
- **Busca:** encontra prompts por palavra (ex.: "logo", "produto", "3D", "tipografia").
- **Categorias:** Motion graphics, Explicativos, Cenas 3D, Jogos e interativos.
- **Tecnologia:** canvas, threejs, gsap, shader…
- **"só prompts completos":** esconde os modelos em que o autor publicou só parte do prompt.
- Clique num card para ver o **vídeo original**, o **remake ao vivo** e o **prompt** completo.

### Aba Projetos
Cada animação gerada vira um projeto, com prévia ao vivo e 6 abas: **Refinar · Som · Renderizar · Versões · Código · Prompt**.

### Aba Editor
Uma edição estilo CapCut, com mídia à esquerda, prévia no centro, painel de ajustes à direita e a timeline embaixo.

### ⚙ Configurações
É onde você cola a chave da **ElevenLabs** (opcional). A chave fica salva **só no seu PC**.

✅ **Checklist:** você abriu as 3 abas e um modelo.

---

## Módulo 3 — Seu primeiro vídeo a partir de um modelo

### 3.1 Escolha o modelo
1. Na aba **Modelos**, busque algo próximo do que você quer (ex.: "logo reveal", "product", "kinetic typography").
2. Abra o card e clique em **"Ver vídeo original ↗"** para ver o resultado de referência.

### 3.2 Use o gerador de prompt
1. No campo **💡 Sua ideia**, escreva em poucas palavras o que você quer.
   *Ex.: "meu produto girando em câmera lenta, partículas douradas, texto 'frete grátis', final com o logo".*
2. Clique em **✦ Gerar prompt da minha ideia**. Em uns 15 segundos o Claude escreve um prompt completo, com cenas e tempos, no estilo do modelo.
3. Leia e ajuste o que quiser. Se não gostar, use **↶ desfazer** ou gere de novo.

### 3.3 Preencha os ajustes
| Campo | Dica |
|---|---|
| **Tema / marca / produto** | Nome da marca e do produto |
| **Textos que aparecem** | Use setas para dar a ordem: `"Frete grátis" → "Só hoje" → "Compre agora"` |
| **Formato** | 9:16 para Reels e TikTok · 4:5 para Feed · 1:1 Quadrado · 16:9 para YouTube |
| **Duração** | De 10 a 15s funciona melhor para anúncios |
| **Paleta** | Ex.: "preto, laranja #FF6A3D e branco" |
| **Instruções extras** | Escreva o que você quer (ex.: "CTA para comprar no link") e clique em **✦ Sugerir instruções extras** |

### 3.4 Adicione suas imagens (opcional)
Em **🖼 Imagens**, clique em **＋ Adicionar imagens** e defina o papel de cada uma:
- **Elemento:** entra no vídeo de verdade (logo, foto do produto, mockup).
- **Referência:** a IA só copia o estilo (cores, composição, clima); a imagem não aparece no vídeo.

Escreva o que é cada imagem ("logo da marca", "pote sabor chocolate"). A IA vê as imagens antes de criar, tanto no gerador de prompt quanto na animação.

> 🎯 Partindo de um modelo, deixe marcado **"ficar fiel ao visual do vídeo original"**. A IA recebe um quadro do vídeo original e reproduz o visual, trocando só o conteúdo pela sua marca.

### 3.5 Escolha o motor
- **Sonnet (Claude):** rápido, ótimo para testar ideias.
- **Opus (Claude):** mais caprichado, use na versão final.
- **GPT-6 Sol (Codex):** aparece se você tiver o app **Codex** (OpenAI) instalado e logado. Costuma levar de 2 a 5 minutos e você pode continuar usando o estúdio enquanto isso.

### 3.6 Gere
Clique em **✦ Gerar animação com Claude**. Leva de 1 a 6 minutos e você pode continuar usando o estúdio enquanto isso. Quando terminar, a animação aparece tocando na tela do projeto.

> 💡 **Já gravou a locução?** Envie o áudio em **"Já tem a locução gravada?"**. O estúdio transcreve a sua fala e a animação já nasce **sincronizada** com ela.

✅ **Checklist:** o seu primeiro projeto aparece em **Projetos** com status "pronto".

---

## Módulo 4 — Ajustar a animação (refinar, versões e código)

### 4.1 Refinar (usa o Claude)
1. Na aba **Refinar**, escreva o que mudar em português. Os atalhos de sugestão ajudam: "mais rápido", "textos maiores", "troque a paleta"…
2. Clique em **✦ Refinar com Claude**. Cada refinamento vira uma **versão nova**.

### 4.2 Versões
Na aba **Versões** você vê e volta para qualquer versão anterior com um clique.

### 4.3 Código: ajustes grátis
Trocar um texto, um preço ou uma cor **não precisa do Claude**:
1. Abra a aba **Código**.
2. Clique dentro do código, aperte **Ctrl+F** e procure o texto (ex.: `97,80`).
3. Troque e clique em **Salvar como nova versão**.

> 💡 Ajustar pelo código não gasta nenhum token. Use o Refinar só para mudanças de movimento, estilo ou cena.

### 4.4 Gerar de novo do zero
Na aba **Prompt**, **↻ Gerar de novo do zero** cria outra interpretação do mesmo pedido.

✅ **Checklist:** você fez 1 refinamento e 1 ajuste pela aba Código.

---

## Módulo 5 — Som: voz, sua gravação e efeitos

Tudo isso fica na aba **Som** do projeto.

### 5.1 Escolha o motor de voz
| Motor | Custo | Observação |
|---|---|---|
| **Piper** | Grátis, offline | Vozes masculinas pt-BR (Faber, Cadu, Jeff). Baixa ~60 MB por voz no 1º uso |
| **Windows** | Grátis, offline | Voz feminina **Maria** (pt-BR) |
| **ElevenLabs** | Créditos ElevenLabs | Qualidade de estúdio, modelo **Eleven v4** |
| **🎤 Meu áudio gravado** | Grátis | A sua própria locução |

### 5.2 Roteiro + voz (Piper, Windows ou ElevenLabs)
1. Em **Tom da locução**, escreva algo como "energético, confiante, anúncio".
2. Clique em **✦ Escrever roteiro com Claude**. Ele **lê a animação** e marca o segundo em que cada fala entra.
3. Ajuste o texto das falas. Escreva números por extenso para a pronúncia sair certa ("trinta gramas").
4. Clique em **🎙 Gerar voz**. Cada fala mostra a duração; aparece ⚠ quando uma fala invade a próxima.

> 💡 **Roteiro sob medida:** antes de escrever, a IA assiste ao vídeo e escreve cada fala dentro do limite de palavras que cabe no tempo. Cada fala mostra o contador **palavras/máximo**, que fica vermelho se passar do limite. Ao gerar, o estúdio mede a duração real das falas e **nunca deixa uma passar por cima da outra**: se precisar, acelera um pouco (até 1,2×, sem mudar o tom, marcado com ⏩) ou faz a próxima esperar (marcado com ↦).

### 5.3 Configurar a ElevenLabs
1. Em **elevenlabs.io → Settings → API Keys**, crie uma chave com as permissões:
   - **Text to Speech**
   - **Sound Effects**
   - **Voices: Read e Write** (para escolher vozes da biblioteca)
   - *(opcional)* **User: Read**, para ver os créditos
2. No estúdio, clique em **⚙**, cole a chave e clique em **Salvar e testar**.
3. Na aba Som, escolha o motor ElevenLabs e clique em **🎧 Escolher voz na biblioteca**.
   - Use **Explorar** para as vozes brasileiras, com filtro **Femininas / Masculinas**, ou **Minhas vozes** para as da sua conta.
   - Clique no **avatar** para **ouvir a amostra**, depois em **Usar**.

> ⚠ Uma voz da biblioteca, ao ser usada, é adicionada à sua conta e ocupa uma vaga de voz do seu plano.

### 5.4 A sua própria gravação (sincronizada)
1. Escolha o motor **🎤 Meu áudio gravado** e envie o arquivo (MP3, WAV, M4A ou até um vídeo).
2. O estúdio **transcreve offline** e mostra o que foi falado, com o tempo de cada frase. Na primeira vez ele baixa o modelo de transcrição (~480 MB).
3. **Atraso do áudio:** um valor positivo empurra a fala para depois; um negativo corta o começo.
4. Clique em **✦ Sincronizar a animação com o meu áudio**. O Claude refaz os tempos para cada texto entrar quando você fala aquilo.

### 5.5 Sonoplastia (efeitos sonoros) com qualidade de cinema
A IA **assiste ao vídeo** antes de criar o som:
- vê quadros com o tempo de cada um;
- detecta os cortes de cena, os picos de movimento (e de que lado), os flashes de luz e os trechos calmos;
- lê a sua locução e o código da animação.

Com isso ela monta um **desenho de som** com intenção: impactos no quadro exato, risers que terminam na revelação, camadas nos momentos-chave, pan seguindo o movimento, reverb, silêncios dramáticos antes do clímax, ambiência contínua e um stinger no final.

1. Escolha de onde vêm os sons:
   - **ElevenLabs Sound Effects** (recomendado): sons gerados por IA, com qualidade de cinema. Usa créditos da sua conta.
   - **Sintetizados pela IA em código** (grátis): mais simples.
   - **Minha biblioteca:** sons seus (comprados ou CC0), e a IA escolhe o arquivo certo para cada momento.
2. Escolha o **estilo** (Cinematográfico, Tech, Luxo, Energia, Orgânico, Suspense, Pop, Game) e a **intensidade** (Sutil, Equilibrado ou Intenso/trailer). Deixe marcada a **ambiência contínua**.
3. Clique em **👁 Assistir ao vídeo e desenhar o som**. Aparecem:
   - o **conceito sonoro**;
   - uma linha do tempo com movimento, cortes, falas e cada som;
   - a lista de sons, com o **porquê** de cada um (💡).
4. Ajuste o que quiser: tempo, alinhamento ("começa em", "termina em", "centro em"), volume, **pan** e **reverb**. Em **↻** você troca só aquele som por outra variação.
5. Clique em **🔊 Gerar sonoplastia**. O estúdio gera cada som, trata (corta o silêncio do começo para o impacto cair no quadro, aplica EQ, pan e reverb de sala) e mixa como no cinema. Clique em **▶** em cada som para ouvi-lo isolado.

> 💡 Sons já gerados ficam salvos: mexer em volume, pan, tempo ou reverb **não gasta créditos de novo**, só remixa (leva segundos).

### 5.6 Ouvir tudo junto
Na aba Som, clique em **▶ Assistir ao vídeo com voz + efeitos**, logo abaixo dos sons gerados, ou em **🔊 Assistir com som**, embaixo da animação.

> 💡 No vídeo final, os efeitos **abaixam sozinhos** quando há fala, e a voz é normalizada para o nível de locução.

✅ **Checklist:** você ouviu a animação com voz e efeitos.

### 5.7 Estúdio de voz (aba 🎙 Voz), a locução com melhor qualidade
Use esta aba quando quiser uma locução de locutor profissional. A voz é gravada **inteira de uma vez** na ElevenLabs, com entonação contínua, e não frase por frase.
1. No topo, escolha o **projeto**.
2. **Gerador de roteiro**: diga sobre o que a voz deve falar (produto, oferta), o tom e a chamada final. Clique em **👁 Assistir ao vídeo e gerar roteiro**. A IA assiste ao vídeo e entrega **3 opções** (direta, emocional, curiosidade), mais uma **direção de voz**.
3. Clique na opção que preferir e ajuste o texto em **Roteiro final**. O contador mostra quantas palavras cabem no vídeo. Os botões (animado, sussurro, pausa…) inserem **tags de emoção** da ElevenLabs.
4. Escolha a **voz** e o modelo e ajuste os controles iguais aos do site da ElevenLabs: velocidade, estabilidade, similaridade e exagero de estilo.
5. Clique em **🎙 Gerar voz**. Cada clique cria um **take**: ouça, use **▶ Ouvir com o vídeo** e compare.
6. Se a voz sair mais curta que o vídeo, o estúdio **encaixa sozinho**: a IA espalha as frases pelo vídeo, cada uma na cena em que o assunto aparece, e cria um take “🎯 encaixado” com a duração do vídeo. Dá para usar também o botão **🎯 Encaixar** em qualquer take.
7. No take escolhido, clique em **✔ Colocar no vídeo**. Se quiser, clique também em **✦ Sincronizar a animação com a voz**: a IA ajusta o tempo de cada cena para a fala.

> 💡 Cada take gasta créditos da ElevenLabs. Acerte o roteiro antes de gerar. Também dá para baixar o MP3 de cada take (⬇).

### 5.8 Cenas IA (aba 🎬 Cenas IA, via Kie.ai)
Use esta aba para cenas **realistas** que a animação em código não faz: pessoas falando (UGC), produto em uso, ambientes.
1. Crie a conta em **kie.ai**, compre créditos (pré-pago, 1 crédito = US$ 0,005) e copie a chave em **kie.ai → API Key**. Cole no topo da aba; ela fica salva só no seu PC.
2. Escolha o modelo: **Veo 3.1 Fast** (pessoa falando com áudio, ~US$ 0,40 por vídeo de 8s), **Veo 3.1 Lite** (mais barato), **Veo 3.1 Quality** (~US$ 2), **Kling 3.0**, **Seedance 2.0 Fast** ou **Grok Imagine**.
3. Escreva a ideia em português e clique em **✦ Escrever prompt com IA**: o Claude monta o prompt profissional (em inglês, com a fala em português).
4. Envie fotos do produto ou da pessoa (opcional) e escolha se são o **primeiro quadro** ou uma **referência**.
5. Clique em **🎬 Gerar vídeo**. Leva de 1 a 5 minutos; o custo real aparece em cada resultado.
6. O vídeo vai direto para a **Mídia do Editor**: monte com as animações, a voz e as legendas.

**🧬 Mapa do personagem (consistência):** clique em **＋ Novo mapa**, envie de 1 a 4 fotos **só do personagem** (rosto, corpo, roupa) e detalhes opcionais. A IA cria uma **descrição fixa**, que vai em todo prompt, e as fotos vão como **referência** (Veo Fast/Lite e Seedance). Escolha o mapa antes de gerar e todos os vídeos mantêm a mesma pessoa, roupa e estilo.

**➡ Continuar:** em um resultado pronto, clique em **➡ Continuar**. O último quadro vira o primeiro do próximo clipe; escreva o que acontece em seguida. Assim você monta um vídeo longo em partes que se encaixam.

> 💡 Teste o prompt no modelo mais barato e só gere no melhor quando estiver bom. Se a pessoa do vídeo for gerada por IA, identifique o anúncio como conteúdo de IA (regras do CONAR e do Meta Ads).

---

## Módulo 6 — Renderizar o MP4

1. Abra a aba **Renderizar** do projeto.
2. Escolha a **resolução**:
   - **cheia**, para publicar;
   - **2/3**, mais rápida;
   - **rascunho**, para conferir.
3. Escolha o **FPS** (30 é o padrão; 60 deixa o movimento mais suave) e a duração.
4. Deixe marcada a opção **"incluir voz e efeitos"**.
5. Clique em **● Renderizar MP4**.

O render roda num navegador invisível com **relógio virtual**: cada quadro sai perfeito, mesmo que o PC seja lento. O vídeo aparece na lista **"Vídeos deste projeto"**, com os botões ⬇ (baixar) e **→ Editor**.

✅ **Checklist:** o seu MP4 abre e toca com som.

---

## Módulo 7 — Editor estilo CapCut

### 7.1 Conhecendo a tela
- **Esquerda: Mídia.** Renders e arquivos importados. Use os botões **＋ Timeline**, **♪ Trilha** e **＋ Áudio**, ou arraste os itens para a timeline.
- **Centro: prévia.** ▶ toca e pausa (tecla **Espaço**); o 🔊 ajusta só o volume da prévia.
- **Direita: painel de ajustes** do item selecionado.
- **Embaixo: timeline**, com régua, **cabeçote** (a linha laranja) e 5 faixas: 🎬 Vídeo · 🅣 Textos · 💬 Legendas · 🎵 Trilha · 🎙 Áudios.

### 7.2 Trazer coisas para a edição
Use o botão **＋ Adicionar à edição** para trazer:
- vídeo ou foto do computador;
- texto;
- legendas automáticas;
- trilha sonora;
- áudio extra;
- cartela de cor.

Também dá para **arrastar arquivos do computador** direto para as faixas.

### 7.3 Cortar e organizar
| Ação | Como |
|---|---|
| Mover o cabeçote | Clique ou arraste na régua · **←/→** um quadro · **Shift+←/→** 1 segundo |
| Cortar começo ou fim | Arraste as **bordas** do clipe |
| Dividir | **✂ Dividir** ou tecla **S** (funciona em clipes, textos e áudios) |
| Reordenar | Arraste o clipe |
| Duplicar / Excluir | **Ctrl+D** / **Delete** |
| Desfazer / Refazer | **Ctrl+Z** / **Ctrl+Y** |

### 7.4 Painel do clipe (abas)
- **Editar:** corte exato, "cortar no cabeçote", volume, silenciar, **separar o áudio**, fades. Em fotos e cartelas, também o movimento de zoom (Ken Burns).
- **Velocidade:** de 0,25× a 4×; o tom da voz se mantém.
- **Filtros:**
  - prontos: Vívido, P&B, Quente, Frio, Vintage, Contraste, Desbotado, Cinema;
  - ajustes de brilho, contraste e saturação;
  - "Aplicar em todos" usa o mesmo filtro em todos os clipes.
- **Transição:** 15 tipos para o próximo clipe, com duração ajustável. Também abre clicando no **+** entre dois clipes.
- **Texto:** um texto preso ao clipe.

### 7.5 Textos animados (faixa 🅣)
1. Posicione o cabeçote e aperte **T**, ou clique em **🅣 Texto**.
2. Escreva o texto e escolha:
   - estilo: Contorno, Caixa preta, Amarelo, Neon ou Faixa vermelha;
   - fonte, cor, tamanho e posição;
   - animação de entrada: Fade, Pop, Subir ou Digitar.
3. Na timeline, **arraste o bloco** para mudar quando o texto entra e **arraste a borda** para mudar quanto tempo ele fica.

### 7.6 Legendas automáticas (faixa 💬)
1. Clique em **💬 Legendas**. O estúdio junta as falas da edição (sem a trilha) e transcreve offline.
2. Escolha o estilo:
   - **Destaque amarelo** (a palavra falada acende, como no CapCut);
   - Destaque verde;
   - Caixa preta;
   - Karaokê;
   - Simples.
3. Ajuste o tamanho, a posição, as MAIÚSCULAS e as **palavras por vez** (2 a 3 é o padrão viral).
4. **Revise o texto:** a transcrição pode errar nomes próprios e marcas. Corrija direto na lista do painel; clicar no tempo leva o cabeçote até o trecho.

### 7.7 Trilha e áudios extras
- **Trilha:** música do vídeo inteiro, com volume e fade de entrada e de saída.
- **Áudio extra:** locução ou efeito num ponto exato. Arraste o bloco para posicionar; a borda direita encurta.

### 7.8 Exportar
Clique em **⬇ Exportar MP4**. Sai tudo junto, no formato escolhido no topo: clipes, transições, filtros, velocidade, textos, legendas e áudio. O arquivo fica na Mídia e tem os botões **⬇ Baixar** e **Abrir pasta**.

> 💡 Na prévia, as transições aparecem como um esmaecer simples. No MP4 sai a transição real escolhida.

✅ **Checklist:** você exportou um vídeo com texto, legendas e trilha.

---

## Módulo 8 — Receitas prontas

### 🍳 Receita 1 — Anúncio de 15s para Reels (≈ 20 min)
1. **Modelos** → busque "product" ou "kinetic" → abra um modelo.
2. Em **💡 Ideia**, escreva o produto, o benefício principal e a oferta → **✦ Gerar prompt**.
3. Escolha formato **9:16** e **15s**. Em Instruções extras, escreva "CTA para comprar no link" → **✦ Sugerir**.
4. Gere com **Sonnet** para testar. Se gostar, **Prompt → Gerar de novo do zero** com **Opus**.
5. **Som:** voz ElevenLabs ou Piper → roteiro → gerar voz. Depois efeitos "sintetizados pelo Claude" → gerar.
6. **Renderizar** em resolução cheia → **→ Editor**.
7. **Editor:** 💬 Legendas no estilo "Destaque amarelo" → revise → ⬇ Exportar.

### 🍳 Receita 2 — Vídeo com a SUA voz
1. Grave a locução no celular (de 15 a 40s, ambiente silencioso).
2. Em **Modelos**, abra um modelo e envie o áudio em **"Já tem a locução gravada?"** → gere.
3. Confira e ajuste o **atraso do áudio** na aba Som, se precisar → Renderizar → Editor → Legendas → Exportar.

### 🍳 Receita 3 — Vídeo longo sem estourar tokens
Para vídeos de 40s ou mais, gere **3 projetos de 12 a 15s** (abertura, benefícios, oferta). Depois junte os três no Editor com **transições** entre eles e uma única **trilha**. Fica mais barato, mais rápido e mais fácil de ajustar.

### 🍳 Receita 4 — Testes A/B rápidos
Duplique o vídeo no Editor e troque só o **primeiro texto** (o gancho) ou o **filtro**. Exporte as duas versões para testar nos anúncios.

---

## Módulo 9 — Economizar tokens e créditos

**Grátis, sem token:**
- render;
- editor inteiro;
- legendas automáticas;
- vozes Piper e Windows;
- a sua gravação;
- efeitos da sua biblioteca;
- edição pela aba Código;
- voltar a uma versão anterior.

**Gasta token (assinatura Claude):** gerar e refinar animações, escrever roteiro, mapear e sintetizar efeitos, gerar prompt e sugerir extras.

**Dicas:**
1. **Teste com Sonnet** e use **Opus** só na versão final.
2. Troque textos, preços e cores na aba **Código**, não no Refinar.
3. **Vídeos curtos** (10 a 15s) custam muito menos. Para vídeos longos, use a Receita 3.
4. Evite instruções de "qualidade máxima absoluta" em vídeos longos: o Claude pensa por muito tempo e pode bater no limite.
5. Na ElevenLabs, as falas e os efeitos já gerados **ficam salvos**. Mudar o volume ou o tempo de um trecho não gasta créditos de novo.

---

## Módulo 10 — Problemas comuns e soluções

| Problema | Solução |
|---|---|
| **"Claude CLI não encontrado"** no topo | Instale o Claude Code (Módulo 1.3), rode `claude` uma vez para fazer login e reabra o estúdio |
| **Não aparecem modelos** | Instale o Git e reabra, ou baixe o ZIP de github.com/yihui-dev/awesome-opus5-5-videos e extraia como `awesome-opus5-5-videos` dentro da pasta do estúdio |
| **Prévia sem som** | Abra no **Chrome ou Edge** (`http://127.0.0.1:4777`); confira o volume da prévia (🔊) e o mixer do Windows. 🔇 nos clipes indica vídeo sem som próprio |
| **Geração parou no meio** | A janela preta foi fechada durante a geração? Abra pelo `Iniciar Estudio.bat`, deixe aberta e peça de novo |
| **"Resposta veio cortada"** | Peça uma animação mais curta ou com menos cenas e gere de novo. A resposta bruta fica salva na pasta do projeto |
| **ElevenLabs: "missing the permission…"** | Edite a chave em elevenlabs.io → API Keys e marque a permissão citada no erro (Voices, Text to Speech, Sound Effects) |
| **Voz Piper ou legendas não funcionam** | Instale o **uv** (Módulo 1.4) e reabra o estúdio |
| **Porta 4777 ocupada** | Outro estúdio já está aberto: feche a outra janela preta |
| **Clipe com ⚠ na timeline** | O arquivo foi apagado da Mídia. Remova o clipe antes de exportar |
| **Texto da animação cortado nas bordas** | Na aba Refinar, peça "mantenha todos os textos dentro da área segura, com margem lateral" |

---

## Módulo 11 — Direitos, licenças e boas práticas

- **Sons do CapCut:** a licença só vale dentro do próprio CapCut. Se quiser usá-los, exporte do estúdio sem efeitos e finalize no CapCut com os sons marcados para uso comercial.
- **Música:** use trilhas royalty-free ou com licença comercial (Pixabay Music, YouTube Audio Library, bibliotecas pagas).
- **Vozes:** confira os termos do seu plano ElevenLabs para uso comercial. As vozes Piper têm licenças individuais.
- **Modelos de prompt:** são inspirações publicadas por criadores. Dê crédito quando fizer sentido, e o resultado final deve ser **seu**.
- **Anúncios:** evite promessas exageradas ("resultado garantido", antes e depois de saúde etc.). As plataformas reprovam.
- **Áreas seguras (9:16):** deixe livres os **15% de cima** e os **20% de baixo**, onde ficam a interface e a legenda do Reels e do TikTok.

---

## Glossário

| Termo | O que é |
|---|---|
| **Modelo** | Prompt pronto de uma animação que já viralizou |
| **Prompt** | O texto que descreve para o Claude o que criar |
| **Refinar** | Pedir ao Claude uma mudança na animação existente |
| **Versão** | Cada estado salvo da animação (v1, v2…) |
| **Render** | Transformar a animação em arquivo MP4 |
| **Cabeçote** | A linha laranja que marca o tempo atual na timeline |
| **Transição** | Efeito de passagem entre dois clipes |
| **Trilha** | Música de fundo do vídeo inteiro |
| **Locução** | A voz que narra o vídeo |
| **Token** | A unidade de uso do Claude; gerar e refinar consome tokens da sua assinatura |
| **Área segura** | A parte da tela que não fica coberta pela interface das redes sociais |

---

🎉 **Parabéns!** Você domina o fluxo completo: **modelo → animação → som → MP4 → edição → publicação**. Agora é criar, testar ganchos diferentes e publicar com frequência.
