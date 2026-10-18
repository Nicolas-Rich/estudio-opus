import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medirSom, fatiar, miniOnda, macioDe } from '../lib/biblioteca/medidas.js';

const SR = 48000;
let s = 1;
const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1; };
const vazio = (seg) => new Float32Array(Math.round(seg * SR));
const ruido = (x, ini, dur, amp = 0.8) => { for (let i = Math.round(ini * SR); i < Math.round((ini + dur) * SR); i++) x[i] = rnd() * amp; return x; };
const seno = (f, seg, amp = 0.5) => Float32Array.from({ length: Math.round(seg * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
const tresCliques = (seg) => { const x = vazio(seg); for (const t of [0.2, 0.6, 1.0]) ruido(x, t, 0.005); return x; };

test('3 cliques separados por silêncio viram 3 fatias nos tempos certos', () => {
  const f = fatiar(tresCliques(1.4), SR);
  assert.equal(f.length, 3);
  [0.195, 0.595, 0.995].forEach((t, k) => assert.ok(Math.abs(f[k].inicio - t) <= 0.01, `fatia ${k}: ${f[k].inicio}`));
  assert.ok(f.every((x) => x.fim - x.inicio >= 0.04 - 1e-9));
});

test('ruído contínuo e arquivo de 90 s não são fatiados', () => {
  assert.deepEqual(fatiar(ruido(vazio(2), 0, 2), SR), []);
  assert.deepEqual(fatiar(tresCliques(90), SR), []);
});

test('brilho: ruído branco é mais brilhante que um grave de 200 Hz', () => {
  assert.ok(medirSom(ruido(vazio(1), 0, 1), SR).brilho > medirSom(seno(200, 1), SR).brilho + 0.3);
});

test('aspereza: 3 kHz é mais áspero que 300 Hz', () => {
  assert.ok(medirSom(seno(3000, 1), SR).aspereza > medirSom(seno(300, 1), SR).aspereza + 0.3);
});

test('ataque: instantâneo < 10 ms; fade de 200 ms > 100 ms', () => {
  assert.ok(medirSom(seno(440, 0.5), SR).ataqueMs < 10);
  const fade = seno(440, 0.5).map((v, i) => v * Math.min(1, i / (0.2 * SR)));
  assert.ok(medirSom(fade, SR).ataqueMs > 100);
});

test('pico e rms em dBFS', () => {
  const m = medirSom(seno(440, 0.5, 0.5), SR);
  assert.ok(Math.abs(m.pico - -6.02) < 0.2, `pico ${m.pico}`);
  assert.ok(Math.abs(m.rms - -9.03) < 0.2, `rms ${m.rms}`);
});

test('mini-onda: 48 valores de 0 a 1 com o máximo em 1', () => {
  const o = miniOnda(tresCliques(1.4));
  assert.equal(o.length, 48);
  assert.ok(o.every((v) => v >= 0 && v <= 1));
  assert.equal(Math.max(...o), 1);
});

test('macio deriva da aspereza', () => {
  assert.equal(macioDe(0.05), 1);
  assert.equal(macioDe(0.3), 0);
  assert.ok(Math.abs(macioDe(0.175) - 0.5) < 1e-9);
});
