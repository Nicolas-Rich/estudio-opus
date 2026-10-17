// Abre o Chromium de verdade: rode com INTEGRACAO=1 node --test test/integracao/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderizarHtml } from '../../lib/render.js';
import { FFPROBE } from '../../lib/ffmpeg.js';

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

test('fundoPreto: página transparente sai sobre preto (não sobre o branco padrão)', { skip: !process.env.INTEGRACAO, timeout: 120_000 }, async () => {
  const { FFMPEG } = await import('../../lib/ffmpeg.js');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'render-preto-'));
  const saida = path.join(pasta, 'p.mp4');
  await renderizarHtml({ url: 'data:text/html,' + encodeURIComponent(html), largura: 200, altura: 200, fps: 10, duracao: 0.5, saida, fundoPreto: true });
  // canto (10,10) fica fora do quadrado vermelho: tem que ser preto
  const px = execFileSync(FFMPEG, ['-v', 'error', '-i', saida, '-vf', 'crop=2:2:10:10', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  assert.ok(px[0] < 30 && px[1] < 30 && px[2] < 30, `canto = ${[...px]}`);
});
