import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gravarWav } from '../lib/faixa-itens.js';
import { lerCatalogo } from '../lib/biblioteca/catalogo.js';
import { importarPacote } from '../lib/biblioteca/pacote.js';

const WIN = process.platform === 'win32';
const BSDTAR = WIN ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
const SR = 48000;
const mono = (seg, f) => { const x = new Float32Array(Math.round(seg * SR)); f(x); return [x, Float32Array.from(x)]; };
const clique = (x, t) => { for (let i = 0; i < 240; i++) x[Math.round(t * SR) + i] = Math.sin(i * 1.3) * 0.8; };
const classificar = async (itens) => new Map(itens.map((i) => [i.id, { categoria: 'foley', tags: ['teste'] }]));

/** Ambiente: dados/biblioteca-sfx (raiz) e uma pasta Downloads, com um zip de 3 WAVs. */
async function ambiente() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pacote-'));
  const raiz = path.join(base, 'dados', 'biblioteca-sfx');
  const downloads = path.join(base, 'Downloads');
  await fs.mkdir(downloads, { recursive: true });
  const orig = path.join(base, 'orig');
  await fs.mkdir(orig);
  await gravarWav(mono(0.1, (x) => clique(x, 0.01)), path.join(orig, 'UIClick_Soft Click_TST.wav'));
  await gravarWav(mono(1.4, (x) => [0.2, 0.6, 1.0].forEach((t) => clique(x, t))), path.join(orig, 'Typewriter keys x3.wav'));
  await gravarWav(mono(0.5, (x) => clique(x, 0.1)), path.join(orig, 'Untitled 07.wav'));
  const zipar = (nome) => { const z = path.join(downloads, nome); execFileSync(BSDTAR, ['-a', '-cf', z, '-C', orig, '.']); return z; };
  return { base, raiz, downloads, zipar };
}

test('importa um zip: catálogo com 3 arquivos + 3 fatias, categorias e zip apagado', { skip: !WIN, timeout: 60_000 }, async () => {
  const { raiz, downloads, zipar } = await ambiente();
  const zip = zipar('pacote-um.zip');
  const r = await importarPacote({ caminho: zip, raiz, pastaZips: downloads, classificar });
  assert.deepEqual({ pacote: r.pacote, arquivos: r.arquivos, fatias: r.fatias, pulados: r.pulados }, { pacote: 'pacote-um', arquivos: 3, fatias: 3, pulados: 0 });
  const cat = await lerCatalogo(raiz);
  assert.equal(cat.pacotes.length, 1);
  assert.equal(cat.sons.length, 6);
  assert.equal(cat.sons.find((s) => s.nome === 'Untitled 07').categoria, 'foley');
  assert.ok(cat.sons.filter((s) => s.nome.startsWith('Typewriter')).every((s) => s.categoria === 'teclado'));
  assert.ok(cat.sons.every((s) => s.categoria));
  assert.ok(!existsSync(zip), 'zip apagado');
  // o mesmo pacote de novo
  const zip2 = zipar('pacote-um.zip');
  await assert.rejects(importarPacote({ caminho: zip2, raiz, pastaZips: downloads, classificar }), /Esse pacote já está na biblioteca/);
});

test('zip corrompido: não muda o catálogo nem deixa pasta pela metade', { skip: !WIN, timeout: 60_000 }, async () => {
  const { raiz, downloads } = await ambiente();
  const ruim = path.join(downloads, 'ruim.zip');
  await fs.writeFile(ruim, 'não é zip');
  await assert.rejects(importarPacote({ caminho: ruim, raiz, pastaZips: downloads, classificar }), /Falha ao descompactar/);
  assert.equal((await lerCatalogo(raiz)).pacotes.length, 0);
  assert.ok(!existsSync(path.join(raiz, 'ruim')));
});

test('pasta parcial de uma importação interrompida é limpa e a importação funciona', { skip: !WIN, timeout: 60_000 }, async () => {
  const { raiz, downloads, zipar } = await ambiente();
  await fs.mkdir(path.join(raiz, 'pacote-dois'), { recursive: true });
  await fs.writeFile(path.join(raiz, 'pacote-dois', 'lixo.wav'), 'lixo');
  const r = await importarPacote({ caminho: zipar('pacote-dois.zip'), raiz, pastaZips: downloads, classificar });
  assert.equal(r.arquivos, 3);
  assert.equal(r.pulados, 0);
  assert.ok(!existsSync(path.join(raiz, 'pacote-dois', 'lixo.wav')));
});

test('caminhos recusados: dentro da biblioteca e zip fora de Downloads', { skip: !WIN }, async () => {
  const { base, raiz, downloads } = await ambiente();
  await fs.mkdir(path.join(raiz, 'x'), { recursive: true });
  await assert.rejects(importarPacote({ caminho: path.join(raiz, 'x'), raiz, pastaZips: downloads, classificar }), /fora da pasta do estúdio/);
  const fora = path.join(base, 'fora.zip');
  await fs.writeFile(fora, 'x');
  await assert.rejects(importarPacote({ caminho: fora, raiz, pastaZips: downloads, classificar }), /pasta Downloads/);
});
