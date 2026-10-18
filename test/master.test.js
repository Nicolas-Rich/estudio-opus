import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FFMPEG } from '../lib/ffmpeg.js';
import { aplicarAudioNoVideo } from '../lib/audio.js';

const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'master-'));
const ff = (...args) => spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const lufs = (arq) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', arq, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(r.stderr);
  return m ? +m[1] : NaN;
};

test('o MP4 final sai masterizado em −14 LUFS, mesmo com áudio baixinho', { timeout: 60_000 }, async () => {
  const video = path.join(pasta, 'preto.mp4');
  const tom = path.join(pasta, 'tom.wav');
  ff('-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=4', '-pix_fmt', 'yuv420p', video);
  // o sine do lavfi já sai a 1/8 (−18 dBFS): −12 dB → −30 dBFS de pico
  ff('-f', 'lavfi', '-i', 'sine=f=440:d=4:r=48000', '-af', 'volume=-12dB', '-ac', '2', tom);
  const saida = path.join(pasta, 'final.mp4');
  await aplicarAudioNoVideo(video, [{ arquivo: tom, volume: 1, tipo: 'efeitos' }], saida);
  const l = lufs(saida);
  assert.ok(Math.abs(l + 14) <= 1, `loudness ${l} LUFS`);
});

test('um efeito de pico alto não derruba o volume final (mede depois do limitador)', { timeout: 60_000 }, async () => {
  const { gravarWav } = await import('../lib/faixa-itens.js');
  const video = path.join(pasta, 'preto2.mp4');
  const tom = path.join(pasta, 'tom2.wav');
  const efx = path.join(pasta, 'efx2.wav');
  ff('-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=3', '-pix_fmt', 'yuv420p', video);
  ff('-f', 'lavfi', '-i', 'sine=f=440:d=3:r=48000', '-af', 'volume=-12dB', '-ac', '2', tom);
  const x = new Float32Array(3 * 48000);
  for (let i = 0; i < 240; i++) x[48000 + i] = Math.sin(i * 1.3) * 0.45;
  await gravarWav([x, Float32Array.from(x)], efx);
  const saida = path.join(pasta, 'final2.mp4');
  await aplicarAudioNoVideo(video, [{ arquivo: tom, volume: 1, tipo: 'voz' }, { arquivo: efx, volume: 1, tipo: 'efeitos' }], saida);
  const l = lufs(saida);
  assert.ok(Math.abs(l + 14) <= 1, `loudness ${l} LUFS`);
});
