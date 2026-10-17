import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarKit } from '../lib/sonoplastia-ia.js';

const valido = {
  escala: { tonica: 'D#', modo: 'dorico', oitava: 5 },
  timbre: 'triangle',
  texturas: { tum: 'soft low felt thump', saida: 'short soft air swish', tique: 'tiny soft tactile tick' },
};

test('kit válido passa como veio', () => {
  assert.deepEqual(normalizarKit(valido), valido);
});

test('valores inválidos viram os padrões', () => {
  const k = normalizarKit({ escala: { tonica: 'H', modo: 'lídio', oitava: 9 }, timbre: 'glass', texturas: {} });
  assert.deepEqual(k.escala, { tonica: 'A', modo: 'pentatonica_maior', oitava: 6 });
  assert.equal(k.timbre, 'soft_fm');
  assert.equal(normalizarKit({ escala: { oitava: 1 } }).escala.oitava, 4);
});

test('textura vazia é omitida', () => {
  const k = normalizarKit({ ...valido, texturas: { tum: '  ', saida: 'swish', tique: null } });
  assert.deepEqual(Object.keys(k.texturas), ['saida']);
});

test('sem kit: null', () => {
  assert.equal(normalizarKit(null), null);
  assert.equal(normalizarKit('x'), null);
});
