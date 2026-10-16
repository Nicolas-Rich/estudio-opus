// Renderiza uma animação HTML em MP4, quadro a quadro, com relógio virtual.
//
// A página nunca roda em tempo real: requestAnimationFrame, performance.now,
// Date.now, setTimeout/setInterval e as animações CSS/WAAPI passam a seguir um
// relógio controlado por nós. A cada quadro avançamos 1/fps segundo, tiramos um
// screenshot via CDP e mandamos o JPEG para o ffmpeg. Assim o vídeo sai fluido
// mesmo que a máquina leve 200 ms para desenhar cada quadro.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { FFMPEG } from './ffmpeg.js';
import { exprPorPartes } from './movimento.js';

const RELOGIO_VIRTUAL = `(() => {
  if (window.__relogio) return;
  let t = 0;
  const inicioReal = Date.now();
  const rafs = new Map();
  let rafId = 0;
  const timers = new Map();
  let timerId = 0;
  const animInicio = new WeakMap();

  Object.defineProperty(performance, 'now', { value: () => t, configurable: true });
  const DateOrig = Date;
  Date.now = () => inicioReal + t;
  window.__RENDER__ = true;

  window.requestAnimationFrame = (cb) => { rafs.set(++rafId, cb); return rafId; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };
  window.setTimeout = (cb, ms, ...args) => {
    timers.set(++timerId, { cb, em: t + Math.max(0, +ms || 0), args, repetir: 0 });
    return timerId;
  };
  window.setInterval = (cb, ms, ...args) => {
    const passo = Math.max(1, +ms || 0);
    timers.set(++timerId, { cb, em: t + passo, args, repetir: passo });
    return timerId;
  };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };

  function executar(fn, args) {
    try { typeof fn === 'function' ? fn(...(args || [])) : (0, eval)(String(fn)); }
    catch (e) { console.error('[render] erro em callback:', e && e.message); }
  }

  function sincronizarAnimacoesCss() {
    if (!document.getAnimations) return;
    for (const a of document.getAnimations()) {
      if (!animInicio.has(a)) { animInicio.set(a, t); try { a.pause(); } catch {} }
      try { a.currentTime = t - animInicio.get(a); } catch {}
    }
  }

  window.__relogio = {
    agora: () => t,
    avancar(ms) {
      const alvo = t + ms;
      // dispara os timers que vencem dentro do intervalo, em ordem
      for (let guarda = 0; guarda < 10000; guarda++) {
        let proximo = null;
        for (const [id, tm] of timers) if (tm.em <= alvo && (!proximo || tm.em < proximo[1].em)) proximo = [id, tm];
        if (!proximo) break;
        const [id, tm] = proximo;
        t = Math.max(t, tm.em);
        if (tm.repetir) tm.em += tm.repetir; else timers.delete(id);
        executar(tm.cb, tm.args);
      }
      t = alvo;
      const lote = [...rafs.values()];
      rafs.clear();
      for (const cb of lote) executar(cb, [t]);
      sincronizarAnimacoesCss();
    },
  };
})();`;

async function abrirNavegador() {
  const args = [
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--hide-scrollbars',
    '--mute-audio',
  ];
  let ultimoErro;
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: true, args });
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw new Error('Não encontrei Chrome nem Edge instalados: ' + (ultimoErro?.message || ''));
}

/**
 * @param {object} o
 * @param {string} o.url          página a renderizar
 * @param {string} o.saida        caminho do .mp4
 * @param {number} o.largura
 * @param {number} o.altura
 * @param {number} o.fps
 * @param {number} o.duracao      segundos gravados
 * @param {number} [o.pularInicio] segundos simulados antes de começar a gravar
 * @param {number} [o.qualidade]  CRF do x264 (menor = melhor)
 * @param {(p:number, msg?:string)=>void} [o.progresso]
 * @param {AbortSignal} [o.sinal]
 */
export async function renderizarHtml(o) {
  const fps = o.fps || 30;
  const total = Math.max(1, Math.round(o.duracao * fps));
  const passo = 1000 / fps;
  const log = (m) => o.progresso?.(undefined, m);

  const navegador = await abrirNavegador();
  let ffmpeg;
  try {
    // O layout é sempre montado no tamanho de projeto (layoutLargura×layoutAltura);
    // resoluções menores só reduzem os pixels via deviceScaleFactor, sem mudar a composição.
    const lw = o.layoutLargura || o.largura;
    const lh = o.layoutAltura || o.altura;
    const contexto = await navegador.newContext({
      viewport: { width: lw, height: lh },
      deviceScaleFactor: o.largura / lw,
    });
    await contexto.addInitScript(RELOGIO_VIRTUAL);
    const pagina = await contexto.newPage();
    pagina.on('console', (m) => { if (m.type() === 'error') log('console: ' + m.text().slice(0, 300)); });
    pagina.on('pageerror', (e) => log('erro na página: ' + e.message.slice(0, 300)));

    log('Abrindo a animação…');
    await pagina.goto(o.url, { waitUntil: 'load', timeout: 90_000 });
    await pagina.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await pagina.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    // texturas/imagens carregam em tempo real; dá uma folga antes de gravar
    await pagina.waitForTimeout(1200);

    const cdp = await contexto.newCDPSession(pagina);
    // transparente: fundo da página sem cor e captura em PNG (com alfa)
    if (o.transparente) await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await pagina.evaluate(() => window.__relogio.avancar(0));

    const pular = Math.round((o.pularInicio || 0) * fps);
    if (pular > 0) {
      log(`Pulando ${o.pularInicio}s iniciais…`);
      for (let i = 0; i < pular; i++) await pagina.evaluate((ms) => window.__relogio.avancar(ms), passo);
    }

    ffmpeg = spawn(FFMPEG, o.transparente ? [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(fps), '-i', '-',
      ...(o.furo?.length
        ? ['-filter_complex', filtroComFuro({ furo: o.furo, largura: o.largura, altura: o.altura, lw, fps }), '-map', '[out]']
        : ['-vf', `scale=${o.largura}:${o.altura}:flags=lanczos,format=rgba`]),
      '-c:v', 'png', '-pix_fmt', 'rgba', o.saida,
    ] : [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', '-',
      '-vf', `scale=${o.largura}:${o.altura}:flags=lanczos`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(o.qualidade ?? 18),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', o.saida,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let erroFfmpeg = '';
    ffmpeg.stderr.on('data', (d) => { erroFfmpeg += d; });
    const terminou = new Promise((ok, falha) => {
      ffmpeg.on('error', falha);
      ffmpeg.on('close', (code) => (code === 0 ? ok() : falha(new Error('ffmpeg: ' + erroFfmpeg.slice(-800)))));
    });

    log(`Gravando ${total} quadros (${o.largura}×${o.altura}, ${fps} fps)…`);
    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      if (o.sinal?.aborted) throw new Error('Render cancelado');
      const { data } = await cdp.send('Page.captureScreenshot', o.transparente
        ? { format: 'png', captureBeyondViewport: false }
        : { format: 'jpeg', quality: 92, optimizeForSpeed: true, captureBeyondViewport: false });
      const buf = Buffer.from(data, 'base64');
      if (!ffmpeg.stdin.write(buf)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
      await pagina.evaluate((ms) => window.__relogio.avancar(ms), passo);
      if (i % 5 === 0 || i === total - 1) {
        const decorrido = (Date.now() - t0) / 1000;
        const resta = ((total - i - 1) * decorrido) / (i + 1);
        o.progresso?.((i + 1) / total, `Quadro ${i + 1}/${total} · ~${Math.ceil(resta)}s restantes`);
      }
    }
    ffmpeg.stdin.end();
    await terminou;
    // prévia que o Chrome toca com transparência (o .mov PNG fica para a exportação)
    if (o.saidaPreview) {
      log('Gerando a prévia com transparência…');
      await converterPreviewAlfa(o.saida, o.saidaPreview);
    }
    log('Vídeo pronto.');
  } catch (e) {
    try { ffmpeg?.stdin.destroy(); ffmpeg?.kill(); } catch {}
    throw e;
  } finally {
    await navegador.close().catch(() => {});
  }
}

// furo transparente (Edição IA): máscara de alfa com um retângulo preto que se move no tempo.
// furo: [{ t, x, y, w, h }] em pixels do layout; w = 0 → sem furo naquele instante.
// (drawbox só avalia as expressões uma vez; scale/overlay com eval=frame avaliam a cada quadro)
function filtroComFuro({ furo, largura, altura, lw, fps }) {
  const k = largura / lw;
  const q = furo.map((f) => (f.w > 0 && f.h > 0 ? { ...f, x: f.x * k, y: f.y * k, w: f.w * k, h: f.h * k } : { t: f.t, x: -10, y: -10, w: 2, h: 2 }));
  const e = (prop) => exprPorPartes(q.map((f) => ({ t: f.t, v: f[prop] })));
  return `[0:v]scale=${largura}:${altura}:flags=lanczos,format=rgba,split[c][a];[a]alphaextract[al];`
    + `color=c=white:s=${largura}x${altura}:r=${fps},format=rgba[branco];`
    + `color=c=black:s=${largura}x${altura}:r=${fps},format=rgba,scale=w='max(2,${e('w')})':h='max(2,${e('h')})':eval=frame[caixa];`
    + `[branco][caixa]overlay=x='${e('x')}':y='${e('y')}':eval=frame:format=rgb,format=rgba,extractplanes=r[m];`
    + '[al][m]blend=all_mode=multiply:shortest=1[al2];[c][al2]alphamerge,format=rgba[out]';
}

function converterPreviewAlfa(entrada, saida) {
  return new Promise((ok, falha) => {
    const p = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', entrada,
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32', '-auto-alt-ref', '0', saida], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok() : falha(new Error('ffmpeg (prévia): ' + err.slice(-500)))));
  });
}

/** Tira um único quadro (para a capa do projeto). */
export async function capturarQuadro({ url, largura, altura, segundo = 2, saida }) {
  const navegador = await abrirNavegador();
  try {
    const contexto = await navegador.newContext({ viewport: { width: largura, height: altura } });
    await contexto.addInitScript(RELOGIO_VIRTUAL);
    const pagina = await contexto.newPage();
    await pagina.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await pagina.waitForTimeout(800);
    const passos = Math.round(segundo * 30);
    for (let i = 0; i <= passos; i++) await pagina.evaluate(() => window.__relogio.avancar(1000 / 30));
    const cdp = await contexto.newCDPSession(pagina);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    const fs = await import('node:fs/promises');
    await fs.writeFile(saida, Buffer.from(data, 'base64'));
  } finally {
    await navegador.close().catch(() => {});
  }
}
