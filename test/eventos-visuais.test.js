import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarEventos, resumirEventos } from '../lib/eventos-visuais.js';

const C = 48, L = 27, FPS = 15;
/** n quadros RGB da grade; desenhar(i, pintar) pinta células do quadro i. */
function cena(n, fundo, desenhar) {
  const quadros = [];
  for (let i = 0; i < n; i++) {
    const q = new Uint8Array(C * L * 3);
    for (let k = 0; k < C * L; k++) q.set(fundo, k * 3);
    desenhar(i, (x, y, cor) => { if (x >= 0 && x < C && y >= 0 && y < L) q.set(cor, (y * C + x) * 3); });
    quadros.push(q);
  }
  return quadros;
}
const ret = (pintar, x0, y0, w, h, cor) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) pintar(x, y, cor); };
const PRETO = [0, 0, 0], BRANCO = [255, 255, 255], AZUL = [60, 140, 255];
const detectar = (q) => detectarEventos(q, { colunas: C, linhas: L, fps: FPS });
const doTipo = (ev, tipo) => ev.filter((e) => e.tipo === tipo);

test('quadrado que aparece gera 1 entrada no tempo, no lugar e com a área certos', () => {
  const ev = detectar(cena(40, PRETO, (i, p) => { if (i >= 10) ret(p, 20, 10, 6, 6, AZUL); }));
  const e = doTipo(ev, 'entra');
  assert.equal(e.length, 1);
  assert.ok(Math.abs(e[0].t - 10 / FPS) <= 1 / FPS + 1e-9, `t=${e[0].t}`);
  assert.ok(Math.abs(e[0].x - 23 / C) <= 0.05 && Math.abs(e[0].y - 13 / L) <= 0.05, `x=${e[0].x} y=${e[0].y}`);
  assert.ok(Math.abs(e[0].area - 36 / (C * L)) < 1e-6);
});

test('o quadrado que some gera 1 saída', () => {
  const ev = detectar(cena(45, PRETO, (i, p) => { if (i >= 10 && i < 30) ret(p, 20, 10, 6, 6, AZUL); }));
  const s = doTipo(ev, 'sai');
  assert.equal(s.length, 1);
  assert.ok(Math.abs(s[0].t - 2.0) <= 1 / FPS + 1e-9, `t=${s[0].t}`);
});

test('quadrado andando para a direita gera movimento e nenhuma entrada extra no trajeto', () => {
  const ev = detectar(cena(40, PRETO, (i, p) => {
    if (i < 3) return;
    const x = 5 + Math.max(0, Math.min(12, i - 10));
    ret(p, x, 10, 4, 4, AZUL);
  }));
  assert.equal(doTipo(ev, 'entra').length, 1);
  const m = doTipo(ev, 'move');
  assert.ok(m.length >= 1 && m.every((e) => e.dir === 1), JSON.stringify(m));
});

test('quadradinhos surgindo em linha formam um grupo de digitação', () => {
  const ev = detectar(cena(40, PRETO, (i, p) => { for (let k = 0; k < 6; k++) if (i >= 5 + k * 2) ret(p, 6 + k * 3, 12, 2, 2, BRANCO); }));
  const e = doTipo(ev, 'entra');
  assert.equal(e.length, 6);
  assert.equal(new Set(e.map((x) => x.grupo)).size, 1);
  assert.ok(e.every((x) => x.digitacao));
});

test('texto crescendo letra a letra (sem espaço entre elas) também é digitação', () => {
  const ev = detectar(cena(40, PRETO, (i, p) => { const n = Math.max(0, Math.min(8, i - 4)); if (n) ret(p, 10, 12, n * 2, 2, BRANCO); }));
  const e = doTipo(ev, 'entra');
  assert.ok(e.length >= 5, `só ${e.length} entradas`);
  assert.ok(e.every((x) => x.digitacao));
});

test('a tela inteira trocando de cor é um corte, sem entradas', () => {
  const ev = detectar(cena(40, PRETO, (i, p) => { if (i >= 20) ret(p, 0, 0, C, L, AZUL); }));
  assert.equal(doTipo(ev, 'corte').length, 1);
  assert.equal(doTipo(ev, 'entra').length, 0);
});

test('uma célula piscando não gera evento', () => {
  assert.equal(detectar(cena(40, PRETO, (i, p) => { if (i % 2) p(30, 5, BRANCO); })).length, 0);
});

test('fade lento de 15 quadros gera uma única entrada', () => {
  const ev = detectar(cena(45, PRETO, (i, p) => {
    const k = Math.max(0, Math.min(1, (i - 10) / 15));
    if (k > 0) ret(p, 20, 10, 6, 6, AZUL.map((c) => Math.round(c * k)));
  }));
  assert.equal(doTipo(ev, 'entra').length, 1);
});

test('partículas/ruído em 30% da tela não geram entradas', () => {
  let s = 7; // mulberry32: ruído de verdade (o LCG com float perde precisão e repete padrões)
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % 256; };
  const ev = detectar(cena(60, PRETO, (i, p) => { if (i >= 5) for (let y = 0; y < 18; y++) for (let x = 0; x < 22; x++) p(x, y, [rnd(), rnd(), rnd()]); }));
  assert.equal(doTipo(ev, 'entra').length, 0);
});

test('fundo branco: item escuro entra e depois sai', () => {
  const ev = detectar(cena(50, BRANCO, (i, p) => { if (i >= 10 && i < 30) ret(p, 20, 10, 6, 6, [20, 20, 30]); }));
  assert.deepEqual(ev.filter((e) => e.tipo !== 'move').map((e) => e.tipo), ['entra', 'sai']);
});

test('resumo para o Claude traz total, densidade e no máximo 40 eventos', () => {
  const ev = Array.from({ length: 100 }, (_, k) => ({ t: k * 0.1, tipo: 'entra', x: 0.5, y: 0.5, area: 0.001, grupo: 0, dir: 0, digitacao: false }));
  const r = resumirEventos(ev, 10);
  assert.match(r, /100/);
  assert.match(r, /por segundo/);
  assert.ok(r.split('\n').filter((l) => /^\s*-?\s*\d+[.,]\d+\s*s/.test(l)).length <= 40);
});

test('vídeo real: caixa que aparece em 1 s vira 1 entrada em 1,0 ± 0,1 s', { skip: !process.env.INTEGRACAO }, async () => {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const path = await import('node:path');
  const { FFMPEG } = await import('../lib/ffmpeg.js');
  const { quadrosDoVideo } = await import('../lib/eventos-visuais.js');
  const v = path.join(os.tmpdir(), `eventos-${process.pid}.mp4`);
  spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=480x270:r=30:d=3',
    '-vf', "drawbox=x=200:y=100:w=80:h=60:color=0x3c8cff:t=fill:enable='gte(t,1)'", '-pix_fmt', 'yuv420p', v]);
  const r = await quadrosDoVideo(v);
  assert.equal(r.colunas, 48);
  assert.equal(r.linhas, 27);
  const e = detectarEventos(r.quadros, r).filter((x) => x.tipo === 'entra');
  assert.equal(e.length, 1);
  assert.ok(Math.abs(e[0].t - 1) <= 0.1, `t=${e[0].t}`);
});
