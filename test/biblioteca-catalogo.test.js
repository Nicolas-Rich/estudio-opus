import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gravarWav } from '../lib/faixa-itens.js';
import { indexarPacote, buscar, contarCategorias, lerCatalogo, gravarCatalogo } from '../lib/biblioteca/catalogo.js';

const SR = 48000;
const mono = (seg, preencher) => { const x = new Float32Array(Math.round(seg * SR)); preencher(x); return [x, Float32Array.from(x)]; };
const clique = (x, t) => { for (let i = 0; i < 240; i++) x[Math.round(t * SR) + i] = Math.sin(i * 1.3) * 0.8; };

test('indexa um pacote: nomes difíceis, fatias, arquivo longo e arquivo quebrado', { timeout: 60_000 }, async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'bib-'));
  const pasta = path.join(raiz, 'pacote-teste', 'sub pasta');
  await fs.mkdir(pasta, { recursive: true });
  await gravarWav(mono(0.1, (x) => clique(x, 0.01)), path.join(pasta, 'UIClick_Soft Click_TST.wav'));
  await gravarWav(mono(1.4, (x) => [0.2, 0.6, 1.0].forEach((t) => clique(x, t))), path.join(pasta, 'teclas (x3), café.wav'));
  // 90 s com golpes espaçados: só não vira fatias por passar de 60 s
  await gravarWav(mono(90, (x) => [1, 30, 50].forEach((t) => clique(x, t))), path.join(pasta, 'ambiencia longa.wav'));
  await fs.writeFile(path.join(pasta, 'quebrado.wav'), 'isto não é áudio');
  const t0 = Date.now();
  const r = await indexarPacote({ raiz, pasta: path.join(raiz, 'pacote-teste'), pacote: 'pacote-teste' });
  assert.ok(Date.now() - t0 < 15_000, `demorou ${Date.now() - t0} ms`);
  assert.equal(r.arquivos, 3);
  assert.equal(r.pulados, 1);
  assert.equal(r.fatias, 3);
  const teclas = r.sons.find((s) => s.nome === 'teclas (x3), café' && !s.pai);
  const fatias = r.sons.filter((s) => s.pai === teclas.id);
  assert.deepEqual(fatias.map((s) => s.nome), ['teclas (x3), café (golpe 1)', 'teclas (x3), café (golpe 2)', 'teclas (x3), café (golpe 3)']);
  assert.ok(fatias.every((s) => s.inicio != null && s.fim > s.inicio && s.arquivo === teclas.arquivo));
  const longa = r.sons.find((s) => s.nome === 'ambiencia longa');
  assert.ok(Math.abs(longa.duracao - 90) < 0.5, `duração ${longa.duracao}`);
  const ui = r.sons.find((s) => s.nome.startsWith('UIClick'));
  assert.equal(ui.categoria, 'clique');
  assert.equal(ui.arquivo, 'pacote-teste/sub pasta/UIClick_Soft Click_TST.wav');
  assert.equal(ui.onda.length, 48);
  assert.ok(ui.macio >= 0 && ui.macio <= 1);
  await gravarCatalogo(raiz, { versao: 1, pacotes: [{ id: 'pacote-teste' }], sons: r.sons });
  assert.equal((await lerCatalogo(raiz)).sons.length, r.sons.length);
  assert.deepEqual(await lerCatalogo(path.join(raiz, 'nada')), { versao: 1, pacotes: [], sons: [] });
});

const som = (id, nome, extra = {}) => ({ id, nome, descricao: '', tags: [], categoria: 'outros', duracao: 1, macio: 0.5, ...extra });
const SONS = [
  som('1', 'Metal Click Small', { categoria: 'clique', duracao: 0.2, macio: 0.8 }),
  som('2', 'Click Plastic', { categoria: 'clique', duracao: 0.3, macio: 0.2 }),
  som('3', 'Paper Rip', { categoria: 'papel', duracao: 1.5, tags: ['papel'] }),
  som('4', 'Big Whoosh', { categoria: 'whoosh', duracao: 4 }),
  som('5', 'Wood Click', { categoria: 'clique', duracao: 0.2, macio: 0.9, descricao: 'metal hinge' }),
];

test('busca: todas as palavras, filtros juntos, acentos e favoritos', () => {
  assert.deepEqual(buscar(SONS, { q: 'click metal' }).itens.map((s) => s.id), ['1', '5']);
  assert.deepEqual(buscar(SONS, { categoria: 'clique', duracao: 'curto', macio: 'macio' }).itens.map((s) => s.id).sort(), ['1', '5']);
  assert.equal(buscar(SONS, { q: 'CLIQUE' }).total, 3);
  assert.deepEqual(buscar(SONS, { q: 'papél' }).itens.map((s) => s.id), ['3']);
  assert.equal(buscar(SONS, { favoritos: new Set(['4']) }).itens[0].id, '4');
  assert.deepEqual(buscar(SONS, { soFavoritos: true, favoritos: new Set(['2']) }).itens.map((s) => s.id), ['2']);
  assert.equal(buscar(SONS, { duracao: 'longo' }).total, 1);
  assert.equal(buscar(SONS, { duracao: 'medio' }).total, 1);
  assert.equal(buscar(SONS, { macio: 'aspero' }).total, 1);
});

test('paginação e contagem por categoria', () => {
  const p = buscar(SONS, { pagina: 1, porPagina: 2 });
  assert.equal(p.total, 5);
  assert.equal(p.itens.length, 2);
  assert.deepEqual(p.itens.map((s) => s.id), buscar(SONS, {}).itens.slice(2, 4).map((s) => s.id));
  assert.deepEqual(contarCategorias(SONS), { clique: 3, papel: 1, whoosh: 1 });
});
