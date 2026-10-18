import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gravarCatalogo } from '../lib/biblioteca/catalogo.js';
import { obterCatalogo, invalidarCatalogo } from '../lib/biblioteca/cache.js';

test('catálogo compartilhado: lê uma vez, acha por id e recarrega ao invalidar', async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-'));
  await gravarCatalogo(raiz, { versao: 1, pacotes: [{ id: 'p' }], sons: [{ id: 'a1', nome: 'A' }] });
  const um = await obterCatalogo(raiz);
  const dois = await obterCatalogo(raiz);
  assert.equal(um, dois);
  assert.equal(um.porId.get('a1').nome, 'A');
  await gravarCatalogo(raiz, { versao: 1, pacotes: [{ id: 'p' }], sons: [{ id: 'b2', nome: 'B' }] });
  assert.equal((await obterCatalogo(raiz)).porId.get('b2'), undefined, 'sem invalidar, segue o cache');
  invalidarCatalogo();
  assert.equal((await obterCatalogo(raiz)).porId.get('b2').nome, 'B');
});
