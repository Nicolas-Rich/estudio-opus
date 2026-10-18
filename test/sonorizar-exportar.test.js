import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FFMPEG } from '../lib/ffmpeg.js';
import { gravarWav, lerPcm } from '../lib/faixa-itens.js';
import { montarFaixaEfeitos, exportarSonorizado } from '../lib/sonorizar/exportar.js';

const SR = 48000;
const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'export-efx-'));
const raiz = path.join(pasta, 'biblioteca');
await fs.mkdir(path.join(raiz, 'pac'), { recursive: true });
const mono = (seg, f) => { const x = new Float32Array(Math.round(seg * SR)); f(x); return [x, Float32Array.from(x)]; };
const clique = (x, t) => { for (let i = 0; i < 240; i++) x[Math.round(t * SR) + i] = Math.sin(i * 1.3) * 0.8; };
await gravarWav(mono(0.3, (x) => clique(x, 0)), path.join(raiz, 'pac', 'um.wav'));
await gravarWav(mono(1.4, (x) => [0.2, 0.6, 1.0].forEach((t) => clique(x, t))), path.join(raiz, 'pac', 'tres.wav'));
await gravarWav(mono(1, (x) => { for (let i = 0; i < x.length; i++) x[i] = Math.sin(i * 0.05) * 0.5; }), path.join(raiz, 'pac', 'longo.wav'));
const sons = new Map([
  ['um', { id: 'um', arquivo: 'pac/um.wav', inicio: null, fim: null }],
  ['golpe2', { id: 'golpe2', arquivo: 'pac/tres.wav', inicio: 0.595, fim: 0.635 }],
  ['longo', { id: 'longo', arquivo: 'pac/longo.wav', inicio: null, fim: null }],
]);
const picoEntre = (x, a, b) => { let m = 0; for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) m = Math.max(m, Math.abs(x[i])); return m; };

test('faixa de efeitos: duração exata e sons nos tempos dos clipes (inclusive fatia)', async () => {
  const saida = path.join(pasta, 'faixa.wav');
  await montarFaixaEfeitos({ clipes: [{ somId: 'um', t: 0.5, volume: 1 }, { somId: 'golpe2', t: 1.2, volume: 1 }], sons, raiz, duracao: 2, volumeEfeitos: 1, saida });
  const [L] = await lerPcm(saida);
  assert.ok(Math.abs(L.length - 2 * SR) <= 1, `${L.length}`);
  assert.ok(picoEntre(L, 0.49, 0.56) > 0.3, 'clique em 0,5 s');
  assert.ok(picoEntre(L, 1.19, 1.26) > 0.3, 'golpe em 1,2 s');
  assert.ok(picoEntre(L, 0.7, 1.1) < 0.01, 'silêncio entre eles');
});

test('clipe perto do fim com som que passa da duração é cortado sem erro', async () => {
  const saida = path.join(pasta, 'fim.wav');
  await montarFaixaEfeitos({ clipes: [{ somId: 'longo', t: 1.9, volume: 1 }], sons, raiz, duracao: 2, volumeEfeitos: 0.8, saida });
  const [L] = await lerPcm(saida);
  assert.ok(Math.abs(L.length - 2 * SR) <= 1);
});

const lufs = (arq) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', arq, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(r.stderr);
  return m ? +m[1] : NaN;
};

test('exporta o MP4 com áudio original + efeitos em −14 LUFS; vídeo sem áudio também', { timeout: 120_000 }, async () => {
  const faixa = path.join(pasta, 'faixa3.wav');
  await montarFaixaEfeitos({ clipes: [{ somId: 'um', t: 1, volume: 1 }], sons, raiz, duracao: 3, volumeEfeitos: 0.8, saida: faixa });
  const comAudio = path.join(pasta, 'com.mp4');
  spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=3', '-f', 'lavfi', '-i', 'sine=f=440:d=3:r=48000',
    '-af', 'volume=-12dB', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', comAudio]);
  const saida = path.join(pasta, 'com-efeitos.mp4');
  await exportarSonorizado({ video: comAudio, temAudio: true, faixaEfeitos: faixa, saida, pastaTemp: pasta });
  assert.ok(Math.abs(lufs(saida) + 14) <= 1, `loudness ${lufs(saida)}`);
  const mudo = path.join(pasta, 'mudo.mp4');
  spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=3', '-pix_fmt', 'yuv420p', mudo]);
  const saida2 = path.join(pasta, 'mudo-efeitos.mp4');
  await exportarSonorizado({ video: mudo, temAudio: false, faixaEfeitos: faixa, saida: saida2, pastaTemp: pasta });
  const info = spawnSync(FFMPEG, ['-hide_banner', '-i', saida2], { encoding: 'utf8' }).stderr;
  assert.match(info, /Audio:/);
  const sobras = (await fs.readdir(pasta)).filter((n) => /orig|-mix/.test(n));
  assert.deepEqual(sobras, [], 'temporários apagados');
});
