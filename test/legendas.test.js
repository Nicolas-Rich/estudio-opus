import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarAss } from '../lib/legendas.js';

const palavras = [{ p: 'você', inicio: 0, fim: 0.4 }, { p: 'grava', inicio: 0.45, fim: 0.9 }];
const legendas = { ativo: true, estilo: 'minimal', tam: 'p', pos: 'livre', y: 66, maiusculas: false, itens: [{ inicio: 0, fim: 0.9, texto: 'você grava', palavras }] };

test('legenda minimal: minúsculas, destaque roxo e posição no peito', () => {
  const ass = gerarAss({ largura: 1080, altura: 1920, textos: [], legendas });
  const linhas = ass.split('\n').filter((l) => l.startsWith('Dialogue'));
  assert.ok(linhas.length >= 2);
  assert.match(linhas[0], /você/);
  assert.doesNotMatch(linhas[0], /VOCÊ/);
  assert.match(ass, /\\c&H00FA8BA7/i);
  assert.match(linhas[0], /\\pos\(540,1267\)/);
});
