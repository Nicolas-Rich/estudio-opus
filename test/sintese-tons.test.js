import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FFMPEG, sondar } from '../lib/ffmpeg.js';
import { frequenciaDaNota, sintetizarTom, sintetizarDeslize, MODOS } from '../lib/sintese-tons.js';

const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'sintese-tons-'));
const A5 = { tonica: 'A', modo: 'pentatonica_maior', oitava: 5 };
/** PCM mono 48 kHz de um arquivo. */
const pcm = (arq) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', arq, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
};
/** Frequência por cruzamentos de zero (subindo) entre os segundos a e b. */
const freq = (x, a, b) => {
  let n = 0;
  for (let i = Math.round(a * 48000) + 1; i < Math.round(b * 48000); i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n / (b - a);
};

test('graus da escala viram as frequências certas', () => {
  assert.ok(Math.abs(frequenciaDaNota(A5, 0) - 880) < 0.5);
  assert.ok(Math.abs(frequenciaDaNota(A5, 1) - 987.77) < 0.5);
  assert.ok(Math.abs(frequenciaDaNota(A5, 5) - 1760) < 0.5);
  assert.ok(Math.abs(frequenciaDaNota(A5, -1) - 739.99) < 0.5);
  assert.deepEqual(MODOS.pentatonica_maior, [0, 2, 4, 7, 9]);
  assert.equal(MODOS.maior.length, 7);
});

test('tom sine de 880 Hz: WAV 48 kHz estéreo, 0,2–0,4 s, afinado em ±1%', async () => {
  const arq = await sintetizarTom({ freq: 880, timbre: 'sine', saida: path.join(pasta, 'a5.wav') });
  const s = await sondar(arq);
  assert.ok(s.duracao >= 0.2 && s.duracao <= 0.4, `duração ${s.duracao}`);
  const f = freq(pcm(arq), 0.01, 0.15);
  assert.ok(Math.abs(f - 880) / 880 < 0.01, `frequência ${f}`);
  const info = spawnSync(FFMPEG, ['-hide_banner', '-i', arq], { encoding: 'utf8' }).stderr;
  assert.match(info, /48000 Hz, (stereo|2 channels)/); // WAV não guarda o nome do layout
});

test('timbres soft_fm e triangle também geram arquivo', async () => {
  for (const timbre of ['soft_fm', 'triangle']) {
    const arq = await sintetizarTom({ freq: 660, timbre, saida: path.join(pasta, `${timbre}.wav`) });
    assert.ok((await sondar(arq)).duracao > 0.15, timbre);
  }
});

test('deslize vai da nota de partida à de chegada', async () => {
  const arq = await sintetizarDeslize({ de: 660, ate: 990, timbre: 'sine', duracao: 0.25, saida: path.join(pasta, 'deslize.wav') });
  const x = pcm(arq);
  const ini = freq(x, 0.0, 0.03), fim = freq(x, 0.21, 0.24);
  assert.ok(Math.abs(ini - 660) / 660 < 0.05, `início ${ini}`);
  assert.ok(Math.abs(fim - 990) / 990 < 0.05, `fim ${fim}`);
});
