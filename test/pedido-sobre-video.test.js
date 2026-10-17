import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarPedido, montarRefino, montarSincronia } from '../lib/claude.js';

const ajustes = { largura: 1080, altura: 1920, duracao: 20, sobreVideo: true };

test('com vídeo por baixo, gerar exige fundo transparente e não cobrir o rosto', () => {
  const p = montarPedido({ prompt: 'títulos animados', ajustes });
  assert.match(p, /background:\s*transparent/);
  assert.match(p, /rosto/i);
});

test('refinar e sincronizar mantêm a regra do vídeo por baixo', () => {
  assert.match(montarRefino({ htmlAtual: '<html></html>', instrucao: 'mais rápido', ajustes }), /background:\s*transparent/);
  assert.match(montarSincronia({ htmlAtual: '<html></html>', locucao: 'fala', ajustes }), /background:\s*transparent/);
});

test('sem vídeo por baixo, nada muda', () => {
  assert.doesNotMatch(montarPedido({ prompt: 'x', ajustes: { ...ajustes, sobreVideo: false } }), /background:\s*transparent/);
});
