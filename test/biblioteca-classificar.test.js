import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerNomeUcs } from '../lib/biblioteca/ucs.js';
import { CATEGORIAS, categoriaPorRegras, classificarComClaude } from '../lib/biblioteca/classificar.js';

const regra = (nome, descricao = '') => categoriaPorRegras({ ucs: lerNomeUcs(nome), nome, descricao })?.categoria ?? null;

test('nome no padrão UCS', () => {
  assert.deepEqual(lerNomeUcs('WHSHAir_Fast Swoosh Short_ACME_SFX.wav'), { catId: 'WHSHAir', familia: 'WHSH', descricao: 'Fast Swoosh Short', criador: 'ACME' });
  assert.equal(lerNomeUcs('meu som 01.wav'), null);
});

test('15 categorias na ordem da spec', () => {
  assert.deepEqual(CATEGORIAS.map((c) => c.id), ['clique', 'tique', 'teclado', 'papel', 'ui', 'whoosh', 'swish', 'impacto', 'grave', 'riser', 'glitch', 'brilho', 'ambiente', 'foley', 'outros']);
  assert.ok(CATEGORIAS.every((c) => c.rotulo && c.icone));
});

test('regras pelo início do CatID UCS', () => {
  assert.equal(regra('UIClick_Soft Button_ACME_X.wav'), 'clique');
  assert.equal(regra('UIBeep_Confirm Tone_ACME_X.wav'), 'ui');
  assert.equal(regra('DSGNImpt_Deep Hit_ACME_X.wav'), 'impacto');
  assert.equal(regra('DSGNMisc_Strange Thing_ACME_X.wav'), null);
});

test('regras por palavras no nome', () => {
  assert.equal(regra('Typewriter Keys Fast.wav'), 'teclado');
  assert.equal(regra('paper rip.wav'), 'papel');
  assert.equal(regra('Glass shimmer sparkle.wav'), 'brilho');
  assert.equal(regra('Room Tone Office.wav'), 'ambiente');
  assert.equal(regra('Untitled 07.wav'), null);
});

test('tags em português', () => {
  const r = categoriaPorRegras({ ucs: null, nome: 'Soft Wood Knock click.wav', descricao: '' });
  assert.ok(r.tags.includes('suave') && r.tags.includes('madeira'), JSON.stringify(r));
});

test('Claude classifica o resto em lotes de 150; resposta inválida vira "outros"', async () => {
  const itens = [{ id: 'a', nome: 'Foo', descricao: '' }, { id: 'b', nome: 'Bar', descricao: '' }];
  const ok = await classificarComClaude(itens, { perguntar: async () => ({ texto: '```json\n[{"id":"a","categoria":"whoosh","tags":["ar"]},{"id":"b","categoria":"inventada","tags":[]}]\n```' }) });
  assert.equal(ok.get('a').categoria, 'whoosh');
  assert.deepEqual(ok.get('a').tags, ['ar']);
  assert.equal(ok.get('b').categoria, 'outros');
  const ruim = await classificarComClaude(itens, { perguntar: async () => ({ texto: 'não sei' }) });
  assert.equal(ruim.get('a').categoria, 'outros');
  assert.equal(ruim.get('b').categoria, 'outros');
  let chamadas = 0;
  const muitos = Array.from({ length: 310 }, (_, k) => ({ id: `i${k}`, nome: `n${k}`, descricao: '' }));
  await classificarComClaude(muitos, { perguntar: async () => { chamadas++; return { texto: '[]' }; } });
  assert.equal(chamadas, 3);
});

test('cada lote do Claude tem timeout de 3 min e avisa "lote k de N"', async () => {
  const vistos = [];
  const avisos = [];
  const itens = Array.from({ length: 310 }, (_, k) => ({ id: `i${k}`, nome: `n${k}`, descricao: '' }));
  await classificarComClaude(itens, { perguntar: async (o) => { vistos.push(o.timeoutMs); return { texto: '[]' }; }, aoLote: (k, n) => avisos.push(`${k}/${n}`) });
  assert.deepEqual(vistos, [180_000, 180_000, 180_000]);
  assert.deepEqual(avisos, ['1/3', '2/3', '3/3']);
});
