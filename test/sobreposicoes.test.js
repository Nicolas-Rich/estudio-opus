import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { filtrosSobreposicoes, resolverSobreposicoes } from '../lib/sobreposicoes.js';

const indice = () => { let n = 5; return () => n++; };

test('lista vazia não muda o grafo', () => {
  assert.deepEqual(filtrosSobreposicoes({ sobreposicoes: [], rv: '[cv3]', indiceEntrada: indice(), total: 10 }), { filtros: [], rv: '[cv3]' });
});

test('cada sobreposição vira overlay com enable no tempo certo', () => {
  const r = filtrosSobreposicoes({ sobreposicoes: [{ arquivo: 'a.mov', inicio: 2.5, fim: 3, x: 108, y: 192, w: 864, h: 384 }], rv: '[cv1]', indiceEntrada: indice(), total: 10 });
  const g = r.filtros.join(';');
  assert.match(g, /\[5:v\]format=rgba,setpts=PTS-STARTPTS\+2\.5\/TB,scale=864:384\[ov0\]/);
  assert.match(g, /\[cv1\]\[ov0\]overlay=108:192:enable='between\(t,2\.5,3\)'/);
  assert.equal(r.rv, '[so0]');
});

test('sobreposição depois do fim do vídeo é ignorada', () => {
  const r = filtrosSobreposicoes({ sobreposicoes: [{ arquivo: 'a.mov', inicio: 12, fim: 13, x: 0, y: 0, w: 10, h: 10 }], rv: '[cv1]', indiceEntrada: indice(), total: 10 });
  assert.deepEqual(r, { filtros: [], rv: '[cv1]' });
});

test('resolver monta o caminho do render e ignora arquivo que sumiu', () => {
  const lista = [{ edicaoId: 'ed1', elId: 'e1', inicio: 0, fim: 1 }, { edicaoId: 'ed1', elId: 'e2', inicio: 1, fim: 2 }];
  const pasta = path.join('dados', 'edicoes-ia');
  const r = resolverSobreposicoes(lista, pasta, (arq) => arq.includes('e1'));
  assert.equal(r.length, 1);
  assert.equal(r[0].arquivo, path.join(pasta, 'ed1', 'elementos', 'e1', 'render.mov'));
});

test('resolver recusa ids com caminho (../)', () => {
  assert.equal(resolverSobreposicoes([{ edicaoId: '..', elId: 'x' }], 'p', () => true).length, 0);
});
