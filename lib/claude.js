// Gera/refina a animação HTML chamando o Claude Code CLI em modo headless
// (`claude -p`), usando o login da assinatura do usuário — sem API key.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { perguntarCodex } from './codex.js';
import { blocoEstilo } from './estilos.js';

export const MODELOS_CLAUDE = [
  { id: 'claude-opus-5-5', nome: 'Opus 5.5 (o mesmo dos vídeos do repo)' },
  { id: 'claude-sonnet-5-5', nome: 'Sonnet 5.5 (mais rápido)' },
  { id: 'claude-fable-5-1', nome: 'Fable 5.1' },
];

// Variáveis que trocariam a assinatura por API key / outro provedor (cobrança extra).
const PREFIXOS_CONFLITO = ['ANTHROPIC_', 'CLAUDE_CODE_USE_'];
const PRESERVAR = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_CONFIG_DIR', 'CLAUDE_CONFIG_DIR']);

function ambienteAssinatura() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (PRESERVAR.has(k)) continue;
    if (PREFIXOS_CONFLITO.some((p) => k.startsWith(p)) || k === 'AWS_BEARER_TOKEN_BEDROCK'
      || (k.startsWith('CLAUDE_CODE_SKIP_') && k.endsWith('_AUTH'))) delete env[k];
  }
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || '64000';
  // limita o "pensamento": em pedidos enormes o Opus gastava todo o limite de saída pensando e
  // nunca escrevia o HTML (travava em "Limite de saída atingido" por 30+ min)
  env.MAX_THINKING_TOKENS = env.MAX_THINKING_TOKENS || '12000';
  return env;
}

const SISTEMA = `Você é um motion designer e criative coder de elite. Você escreve animações
como código (HTML + CSS + JavaScript, Canvas 2D, SVG, WebGL/GLSL, Three.js, GSAP)
que depois são gravadas quadro a quadro e viram um vídeo MP4.

REGRAS DE ENTREGA (obrigatórias):
1. Responda com UM único documento HTML completo e autocontido, dentro de um bloco
   \`\`\`html … \`\`\`. Nada de explicações longas fora do bloco (no máximo 2 linhas antes).
2. Bibliotecas externas só via CDN: cdnjs.cloudflare.com, cdn.jsdelivr.net ou unpkg.com
   (ex.: three, gsap). Fontes podem vir do Google Fonts. Sem outros arquivos nem imagens da
   internet: o visual é gerado por código (procedural). EXCEÇÃO: imagens do usuário marcadas como
   ELEMENTO podem ser usadas pelo caminho relativo assets/<arquivo> (ex.: <img src="assets/logo.png">). Se o prompt original citar
   ferramentas externas (Blender, After Effects, MCPs de imagem/vídeo, modelos de IA,
   arquivos de áudio), recrie o resultado equivalente 100% em código no navegador.
3. O palco ocupa a janela inteira (100vw × 100vh, sem margens, sem barras de rolagem) e se
   adapta a window.innerWidth/innerHeight. A proporção final é informada abaixo — componha
   pensando nela (textos e elementos importantes dentro da área segura).
4. A animação começa SOZINHA ao carregar, sem clique, e toda a movimentação deve ser
   dirigida por tempo (requestAnimationFrame + performance.now(), setTimeout, GSAP, CSS
   animations). Nunca dependa de interação do usuário: se for jogo/interativo, crie um
   modo demonstração automático (IA jogando sozinha).
5. Respeite a DURAÇÃO pedida: a peça deve ter começo, meio e fim dentro desse tempo
   (pode fazer loop depois). Em window.__RENDER__ === true não mostre controles, botões,
   dicas de teclado, contadores de FPS nem nenhuma UI de ferramenta.
6. Sem áudio (a trilha é adicionada depois no editor). Sem alert/prompt/console spam.
7. Qualidade de showreel: tipografia caprichada, easing bem feito, composição, cor,
   profundidade, ritmo. Código limpo e performático (até ~1500 linhas).
8. JavaScript válido no Chrome: um erro de sintaxe deixa a tela preta. Nunca escreva sinal
   antes de potência sem parênteses (proibido: Math.exp(-(x/s)**2); certo: Math.exp(-((x/s)**2))).`;

function extrairHtml(texto) {
  const bloco = /```html\s*([\s\S]*?)```/i.exec(texto);
  if (bloco) return bloco[1].trim();
  const ini = texto.search(/<!doctype html|<html/i);
  if (ini >= 0) {
    const fim = texto.toLowerCase().lastIndexOf('</html>');
    return texto.slice(ini, fim > ini ? fim + 7 : undefined).trim();
  }
  return null;
}

const BLOCO_SINCRONIA = (locucao, duracao) => [
  '',
  'LOCUÇÃO GRAVADA — a animação DEVE ser sincronizada com esta fala (o áudio será colocado por cima do vídeo):',
  locucao,
  '',
  'REGRAS DE SINCRONIA:',
  '- Cada texto ou cena entra no momento em que a palavra correspondente é falada (tolerância ±0,15 s).',
  '- Os textos na tela destacam as palavras-chave da fala (não precisa transcrever tudo); números e preços falados aparecem na tela.',
  '- Cortes e transições acontecem nas pausas entre frases; o ritmo visual acompanha o ritmo da fala.',
  `- A duração total do vídeo é ${duracao}s.`,
].join('\n');

/** Bloco que explica ao Claude as imagens enviadas pelo usuário. */
export function blocoImagens(imagens = []) {
  if (!imagens.length) return '';
  const el = imagens.filter((i) => i.papel !== 'referencia' && i.papel !== 'original');
  const ref = imagens.filter((i) => i.papel === 'referencia');
  const orig = imagens.filter((i) => i.papel === 'original');
  return [
    '',
    'IMAGENS DO USUÁRIO (estão na pasta atual; ABRA CADA UMA com a ferramenta Read antes de escrever):',
    ...el.map((i) => `- ELEMENTO "${i.arquivo}"${i.descricao ? ` (${i.descricao})` : ''}: use no vídeo como <img src="assets/${i.arquivo}"> (ou como textura). Mostre com destaque, sem distorcer, com animação de entrada.`),
    orig.some((i) => i.t != null)
      ? `VÍDEO DE REFERÊNCIA: os quadros "${orig.filter((i) => i.t != null).map((i) => i.arquivo).join('", "')}" mostram, em ordem e com o segundo de cada um, o vídeo que o usuário quer RECRIAR. Reproduza a mesma sequência de cenas, nos mesmos tempos (proporcionalmente à duração pedida), com o mesmo enquadramento, paleta, tipografia, elementos gráficos e estilo de transição/movimento que se deduz entre um quadro e o próximo. Troque apenas o conteúdo (textos, marca, produto) pelo que o usuário pediu. NÃO coloque esses quadros como imagens no vídeo.`
      : '',
    ...orig.filter((i) => i.t == null).map((i) => `- QUADRO DO VÍDEO ORIGINAL "${i.arquivo}": é assim que o vídeo do modelo se parece. FIDELIDADE MÁXIMA: reproduza este visual — composição, enquadramento, paleta, tipografia, texturas, iluminação, densidade de elementos e estilo de movimento — trocando só o conteúdo (textos, marca, produto) pelo pedido do usuário. NÃO coloque esta imagem no vídeo.`),
    ...ref.map((i) => `- REFERÊNCIA "${i.arquivo}"${i.descricao ? ` (${i.descricao})` : ''}: NÃO coloque no vídeo; use só como inspiração de estilo, cores, composição e clima.`),
    'Se for elemento com fundo, considere recorte por máscara/arredondamento e sombra para integrar ao visual.',
  ].join(String.fromCharCode(10));
}

// animação feita para ir POR CIMA do vídeo da pessoa (render transparente + composição)
const BLOCO_SOBRE_VIDEO = (ajustes = {}) => (ajustes.sobreVideo ? [
  '',
  'ESTA ANIMAÇÃO VAI POR CIMA DE UM VÍDEO DE UMA PESSOA FALANDO PARA A CÂMERA (o vídeo entra por baixo na montagem):',
  '- Fundo TRANSPARENTE: html, body { background: transparent } e nenhum retângulo, canvas ou cena que pinte a tela inteira.',
  '  Só os elementos aparecem; o vídeo da pessoa fica visível atrás o tempo todo.',
  '- Não cubra o rosto da pessoa (em geral no centro, entre 25% e 70% da altura): títulos e elementos ficam no topo (até ~28%',
  '  da altura), nas laterais ou em cards pequenos; nada importante nos últimos 22% de baixo (botões do Reels).',
  '- Contenção: um elemento por vez, entrando no tempo da palavra a que se refere; trechos de respiro sem nada são bem-vindos.',
  '- Todo texto com sombra ou brilho para ler sobre qualquer fundo do vídeo.',
].join('\n') : '');

export function montarPedido({ prompt, ajustes = {}, locucao, imagens }) {
  const linhas = [];
  linhas.push('Crie esta animação a partir do prompt-modelo abaixo.');
  linhas.push('');
  linhas.push('=== PROMPT-MODELO ===');
  linhas.push(prompt.trim());
  linhas.push('=== FIM DO PROMPT-MODELO ===');
  linhas.push('');
  linhas.push('AJUSTES DESTA VERSÃO (têm prioridade sobre o prompt-modelo):');
  linhas.push(`- Formato: ${ajustes.largura}×${ajustes.altura} px (${ajustes.formatoNome || 'personalizado'}).`);
  linhas.push(`- Duração: ${ajustes.duracao} segundos.`);
  if (ajustes.idioma) linhas.push(`- Todo texto visível no vídeo em: ${ajustes.idioma}.`);
  if (ajustes.tema) linhas.push(`- Tema / assunto / marca: ${ajustes.tema}`);
  if (ajustes.textos) linhas.push(`- Textos que devem aparecer (nesta ordem): ${ajustes.textos}`);
  if (ajustes.cores) linhas.push(`- Paleta / identidade visual: ${ajustes.cores}`);
  const estilo = blocoEstilo(ajustes);
  if (estilo) linhas.push(estilo);
  if (ajustes.extra) linhas.push(`- Instruções extras: ${ajustes.extra}`);
  if (locucao) linhas.push(BLOCO_SINCRONIA(locucao, ajustes.duracao));
  if (imagens?.length) linhas.push(blocoImagens(imagens));
  if (ajustes.sobreVideo) linhas.push(BLOCO_SOBRE_VIDEO(ajustes));
  return linhas.join('\n');
}

export function montarRefino({ htmlAtual, instrucao, ajustes = {}, locucao, imagens }) {
  return [
    'Aqui está a animação atual:',
    '```html',
    htmlAtual,
    '```',
    '',
    `Formato: ${ajustes.largura}×${ajustes.altura}px · duração ${ajustes.duracao}s.`,
    'Faça estas alterações e devolva o HTML COMPLETO atualizado (não só o trecho):',
    instrucao.trim(),
    imagens?.length ? blocoImagens(imagens) : '',
    locucao ? BLOCO_SINCRONIA(locucao, ajustes.duracao) + '\n(Mantenha a sincronia com a locução ao fazer as alterações.)' : '',
    BLOCO_SOBRE_VIDEO(ajustes),
  ].join('\n');
}

/** Re-sincroniza uma animação existente com a locução gravada. */
export function montarSincronia({ htmlAtual, locucao, ajustes = {} }) {
  return [
    'Aqui está a animação atual:',
    '```html',
    htmlAtual,
    '```',
    '',
    `Formato: ${ajustes.largura}×${ajustes.altura}px.`,
    'TAREFA: refaça a LINHA DO TEMPO desta animação para ela ficar sincronizada com a locução abaixo.',
    'Mantenha o estilo visual, as cores, a tipografia e a qualidade. Ajuste durações, atrasos, ordem das cenas e',
    'os textos na tela para acompanharem o que é falado (pode trocar textos para bater com a fala).',
    BLOCO_SINCRONIA(locucao, ajustes.duracao),
    BLOCO_SOBRE_VIDEO(ajustes),
    '',
    'Devolva o HTML COMPLETO atualizado.',
  ].join('\n');
}

/** Gera/refina a animação: devolve { html, texto, custo }. */
const INICIO_HTML = /^\s*<(!doctype|html)/i;
const FIM_HTML = /<\/(html|body|script)>\s*$/i;
const CERCA_INICIAL = /^\s*```[a-z]*[ \t]*\n/i;

export async function gerarComClaude({ pedido, modelo, aoProgresso, sinal, pastaImagens, timeoutMs, aoVivo, esforco }) {
  const r = await perguntarClaude({ sistema: SISTEMA, pedido, modelo, aoProgresso, sinal, pastaImagens, timeoutMs, aoVivo, esforco });
  const html = extrairHtml(r.texto);
  const falhar = (msg) => { const e = new Error(msg); e.texto = r.texto; throw e; };
  if (!html) falhar('O Claude respondeu, mas sem um documento HTML. Início da resposta: ' + r.texto.slice(0, 400));
  // não salva versão quebrada: precisa ter começo e fim de documento
  if (!INICIO_HTML.test(html)) falhar('A resposta do Claude veio sem o começo do HTML (provavelmente cortada pelo limite de tokens). Tente gerar de novo — a resposta bruta foi salva na pasta do projeto.');
  if (!FIM_HTML.test(html)) falhar('A resposta do Claude veio sem o final do HTML (cortada no meio). Tente gerar de novo ou peça uma animação menos extensa — a resposta bruta foi salva na pasta do projeto.');
  return { ...r, html };
}

/**
 * Roda o Claude (sem ferramentas) e devolve { texto, custo, duracaoMs }.
 * aoProgresso(caracteres, msg) é chamado conforme o texto chega.
 */
export async function perguntarClaude(opcoes) {
  const { sistema, pedido, modelo, aoProgresso, sinal, timeoutMs = 20 * 60_000, pastaImagens } = opcoes;
  // motor alternativo: modelos "codex:*" vão para o OpenAI Codex
  if (String(modelo || '').startsWith('codex:')) return perguntarCodex({ sistema, pedido, modelo, aoProgresso, sinal, pastaImagens, timeoutMs });
  if (atualizando) {
    aoProgresso?.(0, 'Esperando terminar a atualização do Claude Code…');
    await atualizando;
  }
  try {
    return await rodarClaude(opcoes);
  } catch (e) {
    // CLI velho demais para o modelo (ou sem uma opção que usamos): atualiza e tenta mais uma vez
    if (sinal?.aborted || !PEDE_ATUALIZACAO.test(e.message)) throw e;
    aoProgresso?.(0, 'O Claude Code está desatualizado — atualizando e tentando de novo…');
    if (!(await atualizarClaude())) throw e;
    return rodarClaude(opcoes);
  }
}

const PEDE_ATUALIZACAO = /newer is required|does not support this model|claude update|unknown option/i;

function rodarClaude({ sistema, pedido, modelo, aoProgresso, sinal, timeoutMs = 20 * 60_000, pastaImagens, aoVivo, esforco }) {
  return opcoesIsolamento().then((isolamento) => new Promise((ok, falha) => {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--system-prompt', sistema,
      // com imagens, libera só a leitura de arquivos (a pasta das imagens é o diretório de trabalho)
      '--tools', pastaImagens ? 'Read' : '',
      ...(pastaImagens ? ['--allowedTools', 'Read'] : []),
      ...isolamento,
      '--no-session-persistence',
    ];
    if (modelo) args.push('--model', modelo);
    // esforço "medium": em pedidos enormes o Opus ficava 20–40 min só raciocinando antes de escrever
    args.push('--effort', esforco || process.env.ESTUDIO_ESFORCO || 'medium');

    // cwd fora de qualquer projeto: o CLI não lê CLAUDE.md alheio
    const p = spawn('claude', args, { cwd: pastaImagens || os.tmpdir(), env: ambienteAssinatura(), stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { p.kill(); falha(new Error(`Tempo esgotado (${Math.round(timeoutMs / 60000)} min) esperando o Claude.`)); }, timeoutMs);
    sinal?.addEventListener('abort', () => p.kill());

    let buffer = '';
    let texto = '';
    // uma entrada por mensagem do assistente: quando a saída estoura o limite de tokens,
    // o CLI continua sozinho numa nova mensagem e o `result` final traz só a última parte
    const partes = [];
    let resultado = null;
    let erroTxt = '';
    let ultimoMotivo = null; // stop_reason da última mensagem (max_tokens = estourou o limite)
    let ferramenta = null;
    let pensou = 0;
    let avisoPensou = 0;
    let pensamento = '';

    p.stdout.on('data', (d) => {
      buffer += d;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const linha = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!linha) continue;
        let ev;
        try { ev = JSON.parse(linha); } catch { continue; }
        const e = ev.type === 'stream_event' ? ev.event : null;
        if (e?.type === 'message_start') {
          partes.push('');
          if (partes.length > 1 && ultimoMotivo === 'max_tokens') aoProgresso?.(texto.length, 'Limite de saída atingido — o Claude está continuando de onde parou…');
        } else if (e?.type === 'message_delta' && e.delta?.stop_reason) {
          ultimoMotivo = e.delta.stop_reason;
        } else if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
          ferramenta = { nome: e.content_block.name, json: '' };
        } else if (e?.type === 'content_block_delta' && e.delta?.type === 'input_json_delta' && ferramenta) {
          ferramenta.json += e.delta.partial_json || '';
        } else if (e?.type === 'content_block_stop' && ferramenta) {
          let arq = '';
          try { arq = JSON.parse(ferramenta.json).file_path || ''; } catch {}
          const curto = arq.replace(/\\/g, '/').split('/').slice(-2).join('/');
          aoProgresso?.(texto.length, /guia-hyperframes/.test(arq) ? `Consultando o guia HyperFrames: ${curto}` : `Olhando: ${curto || ferramenta.nome}`);
          ferramenta = null;
        } else if (e?.type === 'content_block_delta' && e.delta?.type === 'thinking_delta') {
          pensou += (e.delta.thinking || '').length;
          pensamento = (pensamento + (e.delta.thinking || '')).slice(-600);
          aoVivo?.({ pensamento });
          if (pensou - avisoPensou > 4000) { avisoPensou = pensou; aoProgresso?.(texto.length, `Planejando o vídeo… (${Math.round(pensou / 1000)}k de raciocínio)`); }
        } else if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
          if (!partes.length) partes.push('');
          partes[partes.length - 1] += ev.event.delta.text;
          texto += ev.event.delta.text;
          aoProgresso?.(texto.length);
          aoVivo?.({ codigo: texto.slice(-1800) });
        } else if (ev.type === 'result') {
          resultado = ev;
        } else if (ev.type === 'system' && ev.subtype === 'init') {
          aoProgresso?.(0, `Claude conectado (modelo ${ev.model || modelo || 'padrão'})`);
        }
      }
    });
    p.stderr.on('data', (d) => { erroTxt += d; });
    p.on('error', (e) => {
      clearTimeout(timer);
      falha(new Error(e.code === 'ENOENT'
        ? 'Não encontrei o comando "claude". Instale o Claude Code e faça login (claude → /login).'
        : e.message));
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (sinal?.aborted) return falha(new Error('Geração cancelada'));
      // junta todas as mensagens; nas continuações, tira uma cerca ``` repetida no começo
      const juntas = partes.filter(Boolean).map((t, i) => (i === 0 ? t : t.replace(CERCA_INICIAL, ''))).join('');
      const final = juntas.length > (resultado?.result || '').length ? juntas : (resultado?.result || texto);
      if (resultado?.is_error || (code !== 0 && !final)) {
        return falha(new Error((resultado?.result || erroTxt || `claude saiu com código ${code}`).slice(0, 1500)));
      }
      ok({ texto: final, custo: resultado?.total_cost_usd, duracaoMs: resultado?.duration_ms });
    });

    p.stdin.end(pedido, 'utf8');
  }));
}

// Roda o Claude "limpo" (sem hooks, plugins, MCP, skills nem configurações do usuário).
// Versões novas do CLI têm --safe-mode; nas antigas ele não existe e o CLI recusa o comando
// ("unknown option '--safe-mode'"), então usamos as opções equivalentes. Descobre uma vez só.
let isolamento = null;
function opcoesIsolamento() {
  isolamento ??= new Promise((ok) => {
    const equivalentes = ['--strict-mcp-config', '--disable-slash-commands', '--setting-sources', ''];
    const p = spawn('claude', ['--help'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => ok(equivalentes));
    p.on('close', () => ok(/--safe-mode\b/.test(out) ? ['--safe-mode'] : equivalentes));
  });
  return isolamento;
}

/**
 * Roda `claude update` (o servidor chama ao abrir, e perguntarClaude quando o CLI está velho demais).
 * Devolve true se instalou uma versão nova. Pedidos ao Claude esperam a atualização terminar.
 */
let atualizando = null;
export function atualizarClaude() {
  atualizando ??= new Promise((ok) => {
    const p = spawn('claude', ['update'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', () => ok(false));
    p.on('close', () => {
      const m = out.match(/updated from (\S+) to (?:version )?(\S+)/i);
      if (m) {
        console.log(`  Claude Code atualizado: ${m[1]} → ${m[2]}`);
        isolamento = null; // a versão nova pode ter opções diferentes
      } else if (!/up to date|latest/i.test(out)) {
        console.warn('  Não consegui atualizar o Claude Code:', out.trim().split('\n').pop());
      }
      ok(!!m);
    });
  }).finally(() => { atualizando = null; });
  return atualizando;
}

export function versaoClaude() {
  return new Promise((ok) => {
    const p = spawn('claude', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => ok(null));
    p.on('close', () => ok(out.trim() || null));
  });
}
