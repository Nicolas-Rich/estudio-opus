import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argsNormalizar, listaConcat, lerSilencios } from '../lib/edicao-ia/preparar.js';

test('normalizar cobre e corta para 1080x1920 a 30 fps (sem esticar)', () => {
  const a = argsNormalizar({ entrada: 'in.mov', saida: 'out.mp4', temAudio: true }).join(' ');
  assert.match(a, /scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920/);
  assert.match(a, /fps=30/);
  assert.match(a, /-ar 48000 -ac 2/);
  assert.doesNotMatch(a, /anullsrc/);
});

test('vídeo sem áudio ganha silêncio estéreo 48 kHz', () => {
  const a = argsNormalizar({ entrada: 'in.mov', saida: 'out.mp4', temAudio: false }).join(' ');
  assert.match(a, /anullsrc=r=48000:cl=stereo/);
  assert.match(a, /-shortest/);
  assert.match(a, /-map 1:a:0/);
});

test('lista do concat escapa espaço, acento e apóstrofo', () => {
  assert.equal(listaConcat(["C:\\A2 SYSTEM\\vídeo d'ela.mp4"]), "file 'C:/A2 SYSTEM/vídeo d'\\''ela.mp4'\n");
});

test('lerSilencios lê início e fim do silencedetect', () => {
  const err = [
    '[silencedetect @ 000001] silence_start: 1.234',
    '[silencedetect @ 000001] silence_end: 2.5 | silence_duration: 1.266',
    'size=N/A time=00:00:05.00',
    '[silencedetect @ 000001] silence_start: 4.1',
    '[silencedetect @ 000001] silence_end: 4.9 | silence_duration: 0.8',
  ].join('\n');
  assert.deepEqual(lerSilencios(err), [{ inicio: 1.234, fim: 2.5 }, { inicio: 4.1, fim: 4.9 }]);
});

test('silêncio que vai até o fim do vídeo fecha na duração', () => {
  assert.deepEqual(lerSilencios('silence_start: 8.2', 10), [{ inicio: 8.2, fim: 10 }]);
});
