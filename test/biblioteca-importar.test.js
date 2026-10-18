import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listarZips, espacoLivre, extrairZip } from '../lib/biblioteca/importar.js';

const WIN = process.platform === 'win32';
const BSDTAR = WIN ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';

test('lista só zips grandes, marcando os da Sonniss', async () => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'zips-'));
  await fs.writeFile(path.join(d, 'Sonniss.com-GDC2024-x.zip'), Buffer.alloc(11 * 1024 * 1024));
  await fs.writeFile(path.join(d, 'pequeno.zip'), Buffer.alloc(1024 * 1024));
  await fs.writeFile(path.join(d, 'nota.txt'), 'x');
  const z = await listarZips(d);
  assert.equal(z.length, 1);
  assert.equal(z[0].nome, 'Sonniss.com-GDC2024-x.zip');
  assert.equal(z[0].sonniss, true);
  assert.equal(z[0].tamanho, 11 * 1024 * 1024);
  assert.equal(z[0].caminho, path.join(d, 'Sonniss.com-GDC2024-x.zip'));
});

test('espaço livre em bytes', async () => {
  assert.ok((await espacoLivre(os.tmpdir())) > 0);
});

test('extrai um zip e recusa um zip inválido', { skip: !WIN }, async () => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'extrair-'));
  await fs.mkdir(path.join(d, 'orig'));
  await fs.writeFile(path.join(d, 'orig', 'som.wav'), 'RIFF....');
  execFileSync(BSDTAR, ['-a', '-cf', path.join(d, 'a.zip'), '-C', path.join(d, 'orig'), 'som.wav']);
  await extrairZip(path.join(d, 'a.zip'), path.join(d, 'destino'));
  assert.ok(existsSync(path.join(d, 'destino', 'som.wav')));
  await fs.writeFile(path.join(d, 'ruim.zip'), 'isto não é um zip');
  await assert.rejects(extrairZip(path.join(d, 'ruim.zip'), path.join(d, 'destino2')), /^Error: Falha ao descompactar/);
});
