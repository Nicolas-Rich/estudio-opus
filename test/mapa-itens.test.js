import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapearItens, momentosDoPlano, MOMENTOS_GRANDES } from '../lib/mapa-itens.js';

const TODAS = new Set(['tum', 'saida', 'tique']);
const ev = (t, tipo, extra = {}) => ({ t, tipo, x: 0.5, y: 0.5, area: 0.005, grupo: 0, dir: 0, digitacao: false, ...extra });
const mapa = (eventos, o = {}) => mapearItens(eventos, {
  texturas: TODAS, notasPorOitava: 5, intensidade: 'intenso', momentos: [], silencios: [], duracao: 10, ...o,
});
const so = (inst, som) => inst.filter((i) => i.som === som);

test('entradas em sequência sobem a escala e recomeçam depois de 0,6 s', () => {
  const r = mapa([ev(1, 'entra'), ev(1.2, 'entra'), ev(1.4, 'entra'), ev(1.6, 'entra'), ev(2.4, 'entra')]);
  assert.deepEqual(so(r, 'tom').map((i) => i.grau), [0, 1, 2, 3, 0]);
});

test('item grande soa uma oitava abaixo e ganha um "tum" no mesmo instante', () => {
  for (const n of [5, 7]) {
    const r = mapa([ev(1, 'entra', { area: 0.05 })], { notasPorOitava: n });
    assert.equal(so(r, 'tom')[0].grau, -n);
    assert.equal(so(r, 'tum').length, 1);
    assert.equal(so(r, 'tum')[0].t, 1);
  }
});

test('digitação vira tique, sem tom', () => {
  const r = mapa([ev(1, 'entra', { digitacao: true }), ev(1.1, 'entra', { digitacao: true })]);
  assert.equal(so(r, 'tique').length, 2);
  assert.equal(so(r, 'tom').length, 0);
});

test('saída: swish e um tom um grau abaixo do último, a 70% do volume da entrada', () => {
  const r = mapa([ev(1, 'entra'), ev(1.2, 'entra'), ev(3, 'sai')]);
  const entrada = so(r, 'tom')[1];
  const saida = so(r, 'saida')[0];
  const tomSaida = so(r, 'tom').find((i) => i.t === 3);
  assert.ok(saida && tomSaida);
  assert.equal(tomSaida.grau, entrada.grau - 1);
  assert.ok(Math.abs(saida.volume - 0.7 * entrada.volume) < 1e-9);
});

test('movimento vira deslize na direção certa', () => {
  const d1 = so(mapa([ev(1, 'move', { dir: 1 })]), 'deslize')[0];
  const d2 = so(mapa([ev(1, 'move', { dir: -1 })]), 'deslize')[0];
  assert.ok(d1.ate > d1.grau);
  assert.ok(d2.ate < d2.grau);
});

test('corte não gera som de item', () => {
  assert.equal(mapa([ev(1, 'corte', { area: 1 })]).length, 0);
});

test('pan acompanha o lado e fica em ±0,6', () => {
  assert.equal(mapa([ev(1, 'entra', { x: 1 })])[0].pan, 0.6);
  assert.equal(mapa([ev(1, 'entra', { x: 0.5 })])[0].pan, 0);
  assert.equal(mapa([ev(1, 'entra', { x: 0 })])[0].pan, -0.6);
});

test('densidade sutil: 100 entradas em 10 s viram no máximo 20, ficando as maiores', () => {
  const muitos = Array.from({ length: 100 }, (_, k) => ev(k * 0.1, 'entra', { area: k % 10 === 0 ? 0.015 : 0.001 + k * 1e-5 }));
  const r = mapa(muitos, { intensidade: 'sutil' }).filter((i) => i.som !== 'tum');
  assert.ok(r.length <= 20, `${r.length}`);
  for (let k = 0; k < 100; k += 10) assert.ok(r.some((i) => Math.abs(i.t - k * 0.1) < 1e-9), `perdeu o maior em ${k * 0.1}`);
});

test('duas entradas a 40 ms viram uma só', () => {
  assert.equal(so(mapa([ev(1, 'entra'), ev(1.04, 'entra')]), 'tom').length, 1);
});

test('perto de um momento grande o item abaixa para 40%; num silêncio, some', () => {
  const normal = mapa([ev(1, 'entra')])[0].volume;
  assert.ok(Math.abs(mapa([ev(1, 'entra')], { momentos: [1.1] })[0].volume - 0.4 * normal) < 1e-9);
  assert.equal(mapa([ev(1, 'entra')], { silencios: [{ inicio: 0.8, fim: 1.3 }] }).length, 0);
});

test('volume cresce com a área entre 0,22 e 0,45', () => {
  const v = (area) => so(mapa([ev(1, 'entra', { area })]), 'tom')[0].volume;
  assert.ok(Math.abs(v(0) - 0.22) < 1e-9);
  assert.ok(v(0.05) > v(0.005));
  assert.ok(v(0.5) <= 0.45 + 1e-9);
});

test('sem texturas (ElevenLabs falhou): só tons e deslizes; digitação vira tom no grau atual', () => {
  const r = mapa([ev(1, 'entra'), ev(1.2, 'entra', { area: 0.05 }), ev(1.4, 'entra', { digitacao: true }), ev(3, 'sai'), ev(4, 'move', { dir: 1 })],
    { texturas: new Set() });
  assert.ok(r.every((i) => i.som === 'tom' || i.som === 'deslize'), JSON.stringify(r.map((i) => i.som)));
  const dig = r.find((i) => Math.abs(i.t - 1.4) < 1e-9);
  assert.equal(dig.som, 'tom');
  assert.equal(dig.grau, 1);
});

test('momentos do plano: só as categorias grandes', () => {
  assert.ok(MOMENTOS_GRANDES.includes('impacto') && MOMENTOS_GRANDES.includes('stinger'));
  assert.deepEqual(momentosDoPlano([{ inicio: 1, categoria: 'impacto' }, { inicio: 2, categoria: 'ui' }, { inicio: 3, categoria: 'riser' }]), [1, 3]);
});
