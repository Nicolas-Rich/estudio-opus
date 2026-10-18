import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { idDaMidia, novaSonorizacao, lerSonorizacao, gravarSonorizacao, validarClipes } from '../lib/sonorizar/sessao.js';

test('id estável para nomes com espaço, acento e parênteses', () => {
  const a = idDaMidia('meu vídeo (final) 2.mp4');
  assert.equal(a, idDaMidia('meu vídeo (final) 2.mp4'));
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.notEqual(a, idDaMidia('outro.mp4'));
});

test('nova sonorização com os padrões', () => {
  const s = novaSonorizacao({ midia: 'a.mp4', duracao: 10, largura: 1080, altura: 1920, temAudio: true });
  assert.equal(s.id, idDaMidia('a.mp4'));
  assert.equal(s.intensidade, 'equilibrado');
  assert.equal(s.volumeEfeitos, 0.8);
  assert.equal(s.analise, null);
  assert.deepEqual(s.clipes, []);
});

test('grava (atômico) e lê de volta; id inexistente → null', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'sess-'));
  const s = novaSonorizacao({ midia: 'b.mp4', duracao: 5, largura: 1, altura: 1, temAudio: false });
  await gravarSonorizacao(pasta, s);
  const lido = await lerSonorizacao(pasta, s.id);
  assert.equal(lido.midia, 'b.mp4');
  assert.ok(lido.atualizado > 0);
  assert.deepEqual(await fs.readdir(pasta), [`${s.id}.json`]);
  assert.equal(await lerSonorizacao(pasta, 'naoexiste'), null);
});

test('validarClipes descarta som desconhecido e limita tempo e volume', () => {
  const r = validarClipes([
    { uid: 'a', somId: 'x', t: -2, volume: 3 },
    { uid: 'b', somId: 'zz', t: 1, volume: 1 },
    { somId: 'x', t: 99, volume: 0.5 },
  ], { duracao: 10, idsValidos: new Set(['x']) });
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].t, r[0].volume], [0, 1.5]);
  assert.equal(r[1].t, 10);
  assert.ok(r[1].uid);
});
