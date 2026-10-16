// Abre o Chromium de verdade: rode com INTEGRACAO=1 node --test test/integracao/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderizarHtml } from '../../lib/render.js';
import { FFMPEG, FFPROBE } from '../../lib/ffmpeg.js';

const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}
#q{position:absolute;left:50px;top:50px;width:100px;height:100px;background:#f00}</style></head>
<body><div id="q"></div><script>const q=document.getElementById('q');const t0=performance.now();
(function f(){q.style.opacity=Math.min(1,(performance.now()-t0)/300);requestAnimationFrame(f)})();</script></body></html>`;

const sondaStream = (arq) => execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=pix_fmt:stream_tags=alpha_mode', '-of', 'default=nw=1', arq], { encoding: 'utf8' });

test('render transparente gera .mov com alfa e prévia WebM com alfa', { skip: !process.env.INTEGRACAO, timeout: 120_000 }, async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'eia-render-'));
  const saida = path.join(pasta, 'a.mov');
  const saidaPreview = path.join(pasta, 'a.webm');
  await renderizarHtml({ url: 'data:text/html,' + encodeURIComponent(html), largura: 200, altura: 200, fps: 10, duracao: 0.5, saida, saidaPreview, transparente: true });
  assert.match(sondaStream(saida), /pix_fmt=rgba/);
  assert.match(sondaStream(saidaPreview), /alpha_mode=1/i);
});

test('furo deixa transparente o retângulo da pessoa num elemento de tela cheia', { skip: !process.env.INTEGRACAO, timeout: 120_000 }, async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'eia-furo-'));
  const saida = path.join(pasta, 'f.mov');
  const cheio = '<!doctype html><html><body style="margin:0;background:#00f"></body></html>';
  await renderizarHtml({ url: 'data:text/html,' + encodeURIComponent(cheio), largura: 200, altura: 200, fps: 10, duracao: 0.3, saida, transparente: true,
    furo: [{ t: 0, x: 50, y: 50, w: 100, h: 100 }, { t: 0.3, x: 50, y: 50, w: 100, h: 100 }] });
  const px = (x, y) => [...execFileSync(FFMPEG, ['-loglevel', 'error', '-i', saida, '-frames:v', '1', '-vf', `crop=1:1:${x}:${y},format=rgba`, '-f', 'rawvideo', '-'])];
  assert.deepEqual(px(100, 100).slice(3), [0]);
  assert.deepEqual(px(10, 10), [0, 0, 255, 255]);
});

test('furo que muda no tempo: sem furo no começo, com furo depois', { skip: !process.env.INTEGRACAO, timeout: 120_000 }, async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'eia-furo2-'));
  const saida = path.join(pasta, 'g.mov');
  const cheio = '<!doctype html><html><body style="margin:0;background:#00f"></body></html>';
  await renderizarHtml({ url: 'data:text/html,' + encodeURIComponent(cheio), largura: 200, altura: 200, fps: 10, duracao: 0.6, saida, transparente: true,
    furo: [{ t: 0, x: 0, y: 0, w: 0, h: 0 }, { t: 0.2, x: 0, y: 0, w: 0, h: 0 }, { t: 0.3, x: 50, y: 50, w: 100, h: 100 }, { t: 0.6, x: 50, y: 50, w: 100, h: 100 }] });
  const alfa = (ts) => [...execFileSync(FFMPEG, ['-loglevel', 'error', '-ss', String(ts), '-i', saida, '-frames:v', '1', '-vf', 'crop=1:1:100:100,format=rgba', '-f', 'rawvideo', '-'])][3];
  assert.equal(alfa(0.05), 255);
  assert.equal(alfa(0.45), 0);
});
