import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exprPorPartes, filtroMovimento, movimentoNoClipe } from '../lib/movimento.js';

// avalia a expressão do ffmpeg (if/lt/gte) em JavaScript
const avaliar = (expr, t) => new Function('t', 'iff', 'lt', 'gte', `return ${expr.replace(/\bif\(/g, 'iff(')};`)(t, (c, a, b) => (c ? a : b), (a, b) => +(a < b), (a, b) => +(a >= b));

test('exprPorPartes interpola linearmente entre os quadros', () => {
  const e = exprPorPartes([{ t: 0, v: 1 }, { t: 0.35, v: 0.38 }]);
  assert.equal(avaliar(e, 0), 1);
  assert.ok(Math.abs(avaliar(e, 0.175) - 0.69) < 1e-9);
  assert.equal(avaliar(e, 1), 0.38);
});

test('exprPorPartes com três quadros segue cada trecho', () => {
  const e = exprPorPartes([{ t: 0, v: 50 }, { t: 1, v: 20 }, { t: 3, v: 20 }]);
  assert.equal(avaliar(e, 0.5), 35);
  assert.equal(avaliar(e, 2), 20);
});

test('um quadro só vira constante', () => {
  assert.equal(exprPorPartes([{ t: 0, v: 1.25 }]), '1.25');
});

const mov = [{ t: 0, escala: 1, x: 50, y: 50 }, { t: 0.35, escala: 0.38, x: 23, y: 77 }];

test('fundo desfocado usa split e boxblur e termina no rótulo de saída', () => {
  const f = filtroMovimento({ entrada: '[c0]', saida: '[m0]', movimento: mov, W: 1080, H: 1920, fundo: 'desfoque' });
  const g = f.join(';');
  assert.match(g, /^\[c0\]split=2/);
  assert.match(g, /boxblur/);
  assert.match(g, /scale=w='1080\*\(/);
  assert.match(g, /eval=frame\[m0\]$/);
});

test('fundo de cor usa color= e não divide a entrada', () => {
  const g = filtroMovimento({ entrada: '[c0]', saida: '[m0]', movimento: mov, W: 1080, H: 1920, fundo: 'cor', cor: '#101010' }).join(';');
  assert.match(g, /color=c=0x101010:s=1080x1920/);
  assert.doesNotMatch(g, /split/);
  assert.match(g, /\[m0\]$/);
});

test('C1: com 300 quadros a expressão continua certa (soma plana, sem if aninhado)', () => {
  const q = Array.from({ length: 300 }, (_, i) => ({ t: i / 15, v: i % 2 ? 0.4 : 1 }));
  const e = exprPorPartes(q);
  assert.doesNotMatch(e, /if\(/);
  assert.ok(Math.abs(avaliar(e, 1 / 30) - 0.7) < 1e-3); // tempos arredondados a 4 casas
  assert.equal(avaliar(e, 100), q.at(-1).v);
  assert.equal(avaliar(e, -1), 1);
});

test('C1: o ffmpeg aceita a expressão com 300 quadros', async () => {
  const { execFileSync } = await import('node:child_process');
  const { FFMPEG } = await import('../lib/ffmpeg.js');
  const q = Array.from({ length: 300 }, (_, i) => ({ t: i / 15, v: 100 + (i % 7) * 10 }));
  execFileSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=200x200:r=10:d=1',
    '-vf', `scale=w='${exprPorPartes(q)}':h=100:eval=frame`, '-f', 'null', '-']);
});

test('I6: quadros em tempo de mídia viram tempo de saída do clipe (início e velocidade)', () => {
  const r = movimentoNoClipe([{ t: 10, escala: 1, x: 50, y: 50 }, { t: 12, escala: 0.4, x: 24, y: 76 }], 10, 2);
  assert.deepEqual(r.map((k) => k.t), [0, 1]);
});
