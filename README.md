# 🎬 Estúdio Opus

**Estúdio de vídeo com IA que roda no seu computador.** Você parte de **mais de 800 modelos** de animações virais (motion graphics, explicativos, cenas 3D, jogos) e o Claude cria a animação para a **sua** marca. Depois o estúdio coloca voz, efeitos e legendas, monta tudo num editor estilo CapCut e exporta em MP4, pronto para Reels, TikTok, Stories, Feed ou YouTube.

> 📚 **Novo por aqui? Siga o [CURSO.md](CURSO.md)**: um passo a passo completo, do zero ao primeiro vídeo publicado.
> Para consulta rápida, use o [COMO-USAR.md](COMO-USAR.md).

---

## O que ele faz

| | |
|---|---|
| 🧩 **800+ modelos** | Biblioteca de prompts (cresce com o tempo — botão "Atualizar repo") do [awesome-opus5-5-videos](https://github.com/yihui-dev/awesome-opus5-5-videos), com busca e filtros |
| 💡 **Gerador de prompt** | Você escreve a ideia em poucas palavras e o Claude escreve o prompt completo, com cenas e tempos |
| ✦ **Animação com Claude ou Codex** | Usa o **Claude Code** (Opus, Sonnet) ou o **Codex GPT-6 Sol** da sua assinatura, sem API key. Refine em português e volte a qualquer versão |
| 🖼 **Suas imagens** | Envie logo, produto ou fotos como **elemento** (entra no vídeo) ou **referência** (só o estilo). A IA vê as imagens antes de criar |
| 🎯 **Fiel ao modelo** | A IA recebe um quadro do vídeo original e reproduz o visual, trocando só o conteúdo pela sua marca |
| 🎙 **Voz** | Piper e Windows (grátis, offline), **ElevenLabs** com escolha de vozes brasileiras e amostra, ou **a sua própria gravação** |
| 🔁 **Sincronia com a sua fala** | Transcreve o seu áudio e o Claude ajusta a animação para cada texto entrar quando você fala aquilo |
| 💥 **Efeitos sonoros** | Sintetizados pelo Claude (grátis), ElevenLabs Sound Effects ou a sua biblioteca de sons |
| ● **Render para MP4** | Quadro a quadro, com relógio virtual: o vídeo sai liso mesmo em PC fraco |
| ✂ **Editor estilo CapCut** | Timeline, cortes, dividir, velocidade, filtros, 15 transições, textos animados, trilha, áudios, desfazer/refazer |
| 💬 **Legendas automáticas** | Transcrição offline com palavra ativa destacada, no estilo dos apps |

---

## Requisitos

- **Windows 10 ou 11**
- **[Node.js](https://nodejs.org) 20 ou mais novo** (versão LTS)
- **[Git](https://git-scm.com/download/win)** (baixa a biblioteca de modelos na primeira vez)
- **Google Chrome** ou **Microsoft Edge** (usado em segundo plano para o render)
- **[Claude Code](https://claude.com/claude-code)** instalado e logado numa assinatura Claude Pro/Max (para gerar as animações)
- *Opcional:* o app **[Codex](https://openai.com/codex)** (OpenAI) instalado e logado, para usar o motor **GPT-6 Sol**
- *Opcional:* **[uv](https://docs.astral.sh/uv/)**, para as vozes Piper e para transcrição e legendas (Whisper)
- *Opcional:* uma conta **ElevenLabs**, para vozes e efeitos premium

O passo a passo de cada instalação está no **[Módulo 1 do curso](CURSO.md#módulo-1--instalação-passo-a-passo)**.

## Instalação rápida

```bash
git clone https://github.com/a2labsnutrition/estudio-opus.git
```

Outra opção: clique em **Code → Download ZIP** aqui no GitHub e extraia a pasta.

Depois, **dê dois cliques em `Iniciar Estudio.bat`**. Na primeira vez ele instala o que falta e baixa os modelos sozinho. O estúdio abre no navegador em **http://127.0.0.1:4777**.

## Seus dados ficam no seu PC

Tudo o que você cria fica na pasta `dados/` e **nunca vai para o GitHub**, porque ela está no `.gitignore`. Isso inclui projetos, vídeos, áudios, gravações e a sua chave da ElevenLabs. Nada é enviado para servidor nenhum, a não ser:
- os pedidos ao Claude, feitos pelo seu próprio Claude Code;
- os pedidos ao ElevenLabs, se você usar.

## Créditos e licenças

- Código do Estúdio Opus: licença [MIT](LICENSE).
- Modelos de prompt: [awesome-opus5-5-videos](https://github.com/yihui-dev/awesome-opus5-5-videos) (MIT), baixados na primeira execução. Cada prompt é de quem o criou e o link do post original aparece no estúdio.
- ffmpeg via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static); render via [Playwright](https://playwright.dev); vozes [Piper](https://github.com/rhasspy/piper) (cada voz tem a sua licença); transcrição [faster-whisper](https://github.com/SYSTRAN/faster-whisper).
- ElevenLabs, Claude e CapCut são marcas dos seus donos. Este projeto não tem ligação oficial com nenhum deles.
