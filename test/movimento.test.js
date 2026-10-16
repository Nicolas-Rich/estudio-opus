import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exprPorPartes, filtroMovimento } from '../lib/movimento.js';

// avalia a expressão do ffmpeg (if/lt) em JavaScript
const avaliar = (expr, t) => new Function('t', 'iff', 'lt', `return ${expr.replace(/\bif\(/g, 'iff(')};`)(t, (c, a, b) => (c ? a : b), (a, b) => a < b);

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
