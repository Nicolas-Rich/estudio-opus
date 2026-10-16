import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estiloPorId, ESTILOS_EDICAO } from '../lib/edicao-ia/estilos.js';

test('Criador tech é o estilo padrão e traz paleta roxa, legenda minimal e cor cinematográfica', () => {
  const e = estiloPorId(undefined);
  assert.equal(e.id, 'criador-tech');
  assert.ok(e.estilo.paleta.some((c) => /^#[0-9a-f]{6}$/i.test(c)));
  assert.equal(e.legendas.estilo, 'minimal');
  assert.equal(e.filtro, 'roxo');
  assert.ok(e.regrasPlano.length > 100 && e.regrasElemento.length > 100);
});

test('contenção: no máximo um elemento a cada ~4,5 s', () => {
  assert.equal(estiloPorId('criador-tech').maxElementos(33), 8);
  assert.equal(estiloPorId('criador-tech').maxElementos(10), 3);
});

test('estilo "livre" mantém o comportamento antigo (sem regras extras)', () => {
  const l = estiloPorId('livre');
  assert.equal(l.regrasPlano, '');
  assert.equal(l.maxElementos(33), 25);
  assert.equal(l.legendas, null);
});

test('id desconhecido cai no padrão; a lista tem nome e descrição para a tela', () => {
  assert.equal(estiloPorId('nao-existe').id, 'criador-tech');
  for (const e of Object.values(ESTILOS_EDICAO)) assert.ok(e.nome && e.descricao);
});
