import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consertarHtml } from '../lib/checar-html.js';

const s = (js) => `<script>${js}</script>`;

test('conserta sinal antes de potência', () => {
  const r = consertarHtml(s('const a=Math.exp(-((t-1)/.2)**2);'));
  assert.equal(r.trocas, 1);
  assert.equal(r.erros.length, 0);
  assert.match(r.html, /-\(\(\(t-1\)\/\.2\)\*\*2\)/);
});

test('não mexe em subtração binária nem em código válido', () => {
  for (const js of ['const b=x-((t-1)/2)**2;', 'const ok=Math.exp(-(((t-1)/.2)**2));']) assert.equal(consertarHtml(s(js)).trocas, 0);
});
