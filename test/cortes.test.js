import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatosDeCorte } from '../lib/edicao-ia/cortes.js';

test('silêncio vira corte com 0,12 s de respiro de cada lado', () => {
  const r = candidatosDeCorte({ palavras: [{ p: 'oi', inicio: 0, fim: 1 }, { p: 'gente', inicio: 2.5, fim: 3 }], silencios: [{ inicio: 1, fim: 2.5 }], duracao: 3 });
  assert.deepEqual(r, [{ inicio: 1.12, fim: 2.38, motivo: 'silencio' }]);
});

test('silêncio menor que 0,4 s depois do respiro não vira corte', () => {
  assert.deepEqual(candidatosDeCorte({ palavras: [], silencios: [{ inicio: 1, fim: 1.5 }], duracao: 3 }), []);
});

test('vício isolado vira corte; "então" só quando seguido de pausa', () => {
  const palavras = [
    { p: 'Olha', inicio: 0, fim: 0.4 }, { p: 'é…', inicio: 0.5, fim: 0.9 },
    { p: 'então', inicio: 1.0, fim: 1.3 }, { p: 'vamos', inicio: 1.35, fim: 1.7 },
  ];
  const r = candidatosDeCorte({ palavras, silencios: [], duracao: 2 });
  assert.equal(r.length, 1);
  assert.equal(r[0].motivo, 'vicio');
  assert.ok(r[0].inicio >= 0.4 && r[0].fim <= 1.0);
});

test('nunca corta no meio de uma palavra', () => {
  const r = candidatosDeCorte({ palavras: [{ p: 'longa', inicio: 0.9, fim: 1.6 }], silencios: [{ inicio: 0.2, fim: 1.2 }], duracao: 2 });
  for (const c of r) assert.ok(c.fim <= 0.9);
});
