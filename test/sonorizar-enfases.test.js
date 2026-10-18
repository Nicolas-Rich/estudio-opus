import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pedirEnfases } from '../lib/sonorizar/enfases.js';

const frases = [{ inicio: 0.5, fim: 2.1, texto: 'Tudo isso por apenas 97' }, { inicio: 2.4, fim: 3.9, texto: 'clica aqui agora' }];
const palavras = [{ inicio: 1.6, fim: 2.0, p: '97' }, { inicio: 3.3, fim: 3.8, p: 'agora' }];
const resposta = (lista) => async () => ({ texto: '```json\n' + JSON.stringify(lista) + '\n```' });

test('normaliza tempo e categoria e deixa no máximo 1 ênfase a cada 2 s', async () => {
  const r = await pedirEnfases({
    frases, palavras, duracao: 10,
    perguntar: resposta([
      { t: -1, categoria: 'impacto', motivo: 'abertura' },
      { t: 3, categoria: 'explosao', motivo: 'inválida' },
      { t: 4, categoria: 'brilho', motivo: 'preço' },
      { t: 5, categoria: 'whoosh', motivo: 'perto demais' },
    ]),
  });
  assert.deepEqual(r.map((e) => [e.t, e.categoria]), [[0, 'impacto'], [4, 'brilho']]);
  assert.ok(r.every((e) => typeof e.motivo === 'string'));
});

test('pede com timeout de 3 min e manda as frases com tempo', async () => {
  let visto;
  await pedirEnfases({ frases, palavras, duracao: 10, perguntar: async (o) => { visto = o; return { texto: '[]' }; } });
  assert.equal(visto.timeoutMs, 180000);
  assert.match(visto.pedido, /Tudo isso por apenas 97/);
  assert.match(visto.pedido, /0[.,]5/);
});

test('falha ou resposta sem JSON → []; sem frases nem chama o Claude', async () => {
  assert.deepEqual(await pedirEnfases({ frases, palavras, duracao: 10, perguntar: async () => { throw new Error('caiu'); } }), []);
  assert.deepEqual(await pedirEnfases({ frases, palavras, duracao: 10, perguntar: async () => ({ texto: 'não sei' }) }), []);
  let chamou = false;
  assert.deepEqual(await pedirEnfases({ frases: [], palavras: [], duracao: 10, perguntar: async () => { chamou = true; return { texto: '[]' }; } }), []);
  assert.equal(chamou, false);
});
