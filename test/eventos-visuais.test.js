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

// ---- revisão final: fundo, digitação falsa e partículas
test('item visível desde o início que sai: 1 saída, sem fantasma; um item novo no mesmo lugar depois entra', () => {
  const ev = detectar(cena(70, PRETO, (i, p) => { if (i < 15) ret(p, 20, 10, 6, 6, AZUL); if (i >= 40) ret(p, 20, 10, 6, 6, BRANCO); }));
  assert.deepEqual(ev.filter((e) => e.tipo !== 'move').map((e) => e.tipo), ['sai', 'entra']);
  assert.ok(Math.abs(doTipo(ev, 'entra')[0].t - 40 / FPS) <= 1 / FPS + 1e-9);
});

test('wipe para uma cena branca: itens escuros que entram depois são detectados e a saída é saída', () => {
  const ev = detectar(cena(120, PRETO, (i, p) => {
    const k = Math.min(C, Math.max(0, (i - 10) * 6));
    ret(p, 0, 0, k, L, BRANCO);
    for (let n = 0; n < 3; n++) if (i >= 40 + n * 12 && !(n === 2 && i >= 95)) ret(p, 6 + n * 14, 10, 6, 6, [20, 20, 30]);
  }));
  const depois = ev.filter((e) => e.t >= 39 / FPS && e.tipo !== 'move');
  assert.deepEqual(depois.map((e) => e.tipo), ['entra', 'entra', 'entra', 'sai']);
  assert.ok(ev.every((e) => !(e.tipo === 'entra' && e.area > 0.35)), 'o wipe não é um item');
});

test('fade lento do fundo inteiro não vira um item gigante e não cega a cena', () => {
  const ev = detectar(cena(90, PRETO, (i, p) => {
    const k = Math.min(1, i / 30);
    ret(p, 0, 0, C, L, [255, 255, 255].map((c) => Math.round(c * k)));
    if (i >= 50) ret(p, 20, 10, 6, 6, [200, 30, 30]);
  }));
  assert.ok(ev.every((e) => !(e.tipo === 'entra' && e.area > 0.35)));
  assert.equal(doTipo(ev, 'entra').filter((e) => e.t >= 49 / FPS).length, 1);
});

test('item que cresce no lugar (zoom de entrada) é 1 entrada, sem digitação', () => {
  const ev = detectar(cena(40, PRETO, (i, p) => { if (i >= 5) { const r = Math.min(5, 1 + (i - 5)); ret(p, 24 - r, 13 - r, 2 * r, 2 * r, AZUL); } }));
  assert.equal(doTipo(ev, 'entra').length, 1);
  assert.ok(ev.every((e) => !e.digitacao));
});

test('cards empilhados colados entram como itens normais (escadinha), não digitação', () => {
  const ev = detectar(cena(60, PRETO, (i, p) => { for (let n = 0; n < 5; n++) if (i >= 5 + n * 6) ret(p, 14, 3 + n * 4, 20, 4, AZUL); }));
  const e = doTipo(ev, 'entra');
  assert.equal(e.length, 5);
  assert.ok(e.every((x) => !x.digitacao));
});

test('pontinhos de 2 células andando suavemente (partículas) não geram entradas', () => {
  const ev = detectar(cena(150, PRETO, (i, p) => {
    for (let n = 0; n < 25; n++) { const x = (n * 7 + Math.floor(i / 3)) % 20; const y = (n * 3) % 15; ret(p, x, y, 2, 1, BRANCO); }
  }));
  assert.equal(doTipo(ev, 'entra').length, 0);
});

test('mancha que vive só 4 quadros não é item', () => {
  const ev = detectar(cena(40, PRETO, (i, p) => { if (i >= 10 && i < 14) ret(p, 20, 10, 3, 3, AZUL); }));
  assert.equal(doTipo(ev, 'entra').length, 0);
});

test('wipe que cobre um item enquanto outro segue na tela não quebra o detector', () => {
  const ev = detectar(cena(60, PRETO, (i, p) => {
    if (i >= 3) ret(p, 2, 10, 4, 4, AZUL);           // item A (à esquerda)
    if (i >= 3) ret(p, 40, 10, 4, 4, [200, 30, 30]); // item B (à direita)
    if (i >= 30) ret(p, 0, 0, 20, L, BRANCO);        // painel entrando pela borda, cobrindo A
  }));
  assert.ok(Array.isArray(ev));
  assert.ok(ev.every((e) => !(e.tipo === 'entra' && e.area > 0.35)));
});

test('a tela inteira mudando quadro a quadro (zoom, fundo animado) não vira uma enxurrada de cortes', () => {
  const ev = detectar(cena(60, PRETO, (i, p) => { if (i >= 10 && i < 40) ret(p, 0, 0, C, L, [(i * 40) % 256, (i * 70) % 256, 120]); }));
  assert.ok(doTipo(ev, 'corte').length <= 2, `${doTipo(ev, 'corte').length} cortes`);
});
