import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FFMPEG } from '../lib/ffmpeg.js';
import { gravarCatalogo } from '../lib/biblioteca/catalogo.js';
import { invalidarCatalogo } from '../lib/biblioteca/cache.js';
import { idDaMidia, gravarSonorizacao, lerSonorizacao } from '../lib/sonorizar/sessao.js';
import { analisarParaSonorizar } from '../lib/sonorizar/analisar.js';
import { registrarRotasSonorizar } from '../lib/rotas-sonorizar.js';

const NOME = 'meu vídeo (1).mp4';
const ev = (t, tipo, extra = {}) => ({ t, tipo, x: 0.5, y: 0.5, area: 0.005, grupo: 0, dir: 0, digitacao: false, ...extra });
const som = (id, categoria, extra = {}) => ({ id, categoria, duracao: 0.2, macio: 0.5, pai: null, arquivo: `pac/${id}.wav`, nome: `Som ${id}`, onda: [1], pacote: 'pac', ...extra });
const ANALISE = { versao: 1, eventos: Array.from({ length: 30 }, (_, k) => ev(0.1 + k * 0.06, 'entra')), cortes: [], fala: null, enfases: [], pulados: [] };

/** Servidor de teste com Mídia, biblioteca e dependências injetadas. */
async function servidor({ sons = [som('c1', 'clique'), som('c2', 'clique'), som('w1', 'whoosh', { duracao: 0.8 })], analise = async () => ANALISE } = {}) {
  invalidarCatalogo();
  const DADOS = await fs.mkdtemp(path.join(os.tmpdir(), 'rotas-son-'));
  const PASTAS = { midia: path.join(DADOS, 'midia'), temp: path.join(DADOS, 'temp') };
  await fs.mkdir(PASTAS.midia, { recursive: true });
  await fs.mkdir(PASTAS.temp, { recursive: true });
  spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=2', '-pix_fmt', 'yuv420p', path.join(PASTAS.midia, NOME)]);
  await fs.writeFile(path.join(DADOS, 'midia.json'), JSON.stringify([{ nome: NOME, tipo: 'video', duracao: 2, largura: 64, altura: 64, temAudio: false, titulo: 'Meu vídeo', thumb: null }]));
  await gravarCatalogo(path.join(DADOS, 'biblioteca-efeitos'), { versao: 1, pacotes: sons.length ? [{ id: 'pac' }] : [], sons });
  const jobs = new Map();
  const registrados = [];
  const ctx = {
    DADOS, PASTAS,
    criarJob: (tipo, extra = {}) => { const j = { id: `j${jobs.size + 1}`, tipo, status: 'fila', progresso: 0, mensagens: [], controle: new AbortController(), ...extra }; jobs.set(j.id, j); return j; },
    msgJob: (j, m) => { j.mensagens.push({ m }); j.ultima = m; },
    jobPublico: ({ controle, ...j }) => j,
    lerJson: async (a, pad) => { try { return JSON.parse(await fs.readFile(a, 'utf8')); } catch { return pad; } },
    gravarJson: (a, v) => fs.writeFile(a, JSON.stringify(v)),
    registrarMidia: async (arq, extra) => { registrados.push({ nome: path.basename(arq), ...extra }); return { nome: path.basename(arq) }; },
    nomeLivre: async (pasta, base, ext) => { let n = `${base}${ext}`; for (let i = 2; existsSync(path.join(pasta, n)); i++) n = `${base}-${i}${ext}`; return n; },
    deps: {
      analise,
      montarFaixa: async ({ saida }) => { await fs.writeFile(saida, 'faixa'); return saida; },
      exportarVideo: async ({ saida }) => { await fs.writeFile(saida, 'mp4'); },
    },
  };
  const app = express();
  app.use(express.json());
  registrarRotasSonorizar(app, ctx);
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const api = async (url, corpo, method = corpo ? 'POST' : 'GET') => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { status: r.status, dado: await r.json().catch(() => null) };
  };
  const esperar = async (id) => { for (let i = 0; i < 200; i++) { const j = jobs.get(id); if (j.status === 'ok' || j.status === 'erro') return j; await new Promise((r) => setTimeout(r, 20)); } throw new Error('job não terminou'); };
  return { DADOS, PASTAS, api, esperar, registrados, fechar: () => srv.close() };
}

test('análise: etapa que falha vira "pulado"; sem áudio não transcreve', async () => {
  let transcreveu = false;
  const deps = { eventos: async () => [ev(1, 'entra')], cortes: async () => [2], transcrever: async () => { transcreveu = true; throw new Error('whisper'); }, enfases: async () => [] };
  const a = await analisarParaSonorizar({ video: 'x.mp4', temAudio: true, duracao: 5, pastaTemp: os.tmpdir(), deps });
  assert.deepEqual(a.pulados, ['fala']);
  assert.equal(a.eventos.length, 1);
  assert.deepEqual(a.cortes, [2]);
  transcreveu = false;
  await analisarParaSonorizar({ video: 'x.mp4', temAudio: false, duracao: 5, pastaTemp: os.tmpdir(), deps });
  assert.equal(transcreveu, false);
});

test('abrir com a biblioteca vazia → 409', async () => {
  const s = await servidor({ sons: [] });
  try {
    const r = await s.api('/api/sonorizar/abrir', { midia: NOME });
    assert.equal(r.status, 409);
    assert.match(r.dado.erro, /Importe uma biblioteca de efeitos primeiro/);
  } finally { s.fechar(); }
});

test('abrir analisa, sugere e devolve sons e avisos; vídeos listados com id estável', async () => {
  const s = await servidor();
  try {
    const v = await s.api('/api/sonorizar/videos');
    assert.equal(v.dado[0].nome, NOME);
    assert.equal(v.dado[0].id, idDaMidia(NOME));
    const r = await s.api('/api/sonorizar/abrir', { midia: NOME });
    assert.equal(r.status, 200);
    await s.esperar(r.dado.job.id);
    const g = await s.api(`/api/sonorizar/${idDaMidia(NOME)}`);
    assert.ok(g.dado.clipes.length > 0);
    assert.equal(g.dado.sons[g.dado.clipes[0].somId].nome.startsWith('Som '), true);
    assert.ok(Array.isArray(g.dado.faltando));
  } finally { s.fechar(); }
});

test('abrir duas vezes durante a análise devolve o mesmo job', async () => {
  let liberar;
  const s = await servidor({ analise: () => new Promise((r) => { liberar = () => r(ANALISE); }) });
  try {
    const a = await s.api('/api/sonorizar/abrir', { midia: NOME });
    const b = await s.api('/api/sonorizar/abrir', { midia: NOME });
    assert.equal(a.dado.job.id, b.dado.job.id);
    liberar();
    await s.esperar(a.dado.job.id);
  } finally { s.fechar(); }
});

test('nada detectado → sem clipes e aviso', async () => {
  const s = await servidor({ analise: async () => ({ ...ANALISE, eventos: [] }) });
  try {
    const r = await s.api('/api/sonorizar/abrir', { midia: NOME });
    await s.esperar(r.dado.job.id);
    const g = await s.api(`/api/sonorizar/${idDaMidia(NOME)}`);
    assert.deepEqual(g.dado.clipes, []);
    assert.ok(g.dado.avisos.some((a) => /Nada detectado/.test(a)));
  } finally { s.fechar(); }
});

test('PATCH valida; sugerir substitui conforme a intensidade; som sumido é avisado', async () => {
  const s = await servidor();
  const id = idDaMidia(NOME);
  try {
    const r = await s.api('/api/sonorizar/abrir', { midia: NOME });
    await s.esperar(r.dado.job.id);
    const p = await s.api(`/api/sonorizar/${id}`, { clipes: [{ uid: 'a', somId: 'c1', t: 9 }, { uid: 'b', somId: 'nada', t: 1 }], intensidade: 'sutil' }, 'PATCH');
    assert.equal(p.dado.clipes.length, 1);
    assert.equal(p.dado.clipes[0].t, 2);
    assert.equal(p.dado.intensidade, 'sutil');
    const sutil = (await s.api(`/api/sonorizar/${id}/sugerir`, { intensidade: 'sutil' })).dado.clipes.length;
    const intenso = (await s.api(`/api/sonorizar/${id}/sugerir`, { intensidade: 'intenso' })).dado.clipes.length;
    assert.ok(intenso > sutil, `${intenso} > ${sutil}`);
    const pasta = path.join(s.DADOS, 'efeitos-sonorizacoes');
    const salvo = await lerSonorizacao(pasta, id);
    salvo.clipes.push({ uid: 'z', somId: 'sumiu', t: 1, volume: 1, papel: 'manual' });
    await gravarSonorizacao(pasta, salvo);
    const g = await s.api(`/api/sonorizar/${id}`);
    assert.ok(!g.dado.clipes.some((c) => c.somId === 'sumiu'));
    assert.ok(g.dado.avisos.some((a) => /1 som não está mais na biblioteca/.test(a)));
  } finally { s.fechar(); }
});

test('exportar duas vezes cria dois arquivos e não toca no original', async () => {
  const s = await servidor();
  const id = idDaMidia(NOME);
  try {
    const r = await s.api('/api/sonorizar/abrir', { midia: NOME });
    await s.esperar(r.dado.job.id);
    const antes = await fs.stat(path.join(s.PASTAS.midia, NOME));
    for (let k = 0; k < 2; k++) {
      const e = await s.api(`/api/sonorizar/${id}/exportar`, {});
      assert.equal((await s.esperar(e.dado.job.id)).status, 'ok');
    }
    assert.equal(s.registrados.length, 2);
    assert.notEqual(s.registrados[0].nome, s.registrados[1].nome);
    assert.ok(s.registrados.every((x) => x.origem === 'efeitos' && x.titulo === 'Meu vídeo (com efeitos)'));
    const depois = await fs.stat(path.join(s.PASTAS.midia, NOME));
    assert.equal(depois.size, antes.size);
    assert.equal(depois.mtimeMs, antes.mtimeMs);
  } finally { s.fechar(); }
});
