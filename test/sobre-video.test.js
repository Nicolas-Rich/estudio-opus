import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argsComporSobreVideo, dimensoesExibidas } from '../lib/sobre-video.js';

test('vídeo de celular gravado deitado com rotação 90° vira vertical', () => {
  assert.deepEqual(dimensoesExibidas({ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }), { largura: 1080, altura: 1920 });
  assert.deepEqual(dimensoesExibidas({ width: 1920, height: 1080, tags: { rotate: '270' } }), { largura: 1080, altura: 1920 });
  assert.deepEqual(dimensoesExibidas({ width: 1080, height: 1920 }), { largura: 1080, altura: 1920 });
});

const o = { fundo: 'C:/A2 SYSTEM/meu vídeo.mp4', anim: 'anim.mov', saida: 'out.mp4', largura: 1080, altura: 1920, fps: 30, duracao: 12.5 };

test('o vídeo de fundo cobre o quadro sem esticar e a animação vai por cima com alfa', () => {
  const a = argsComporSobreVideo(o);
  const f = a[a.indexOf('-filter_complex') + 1];
  assert.match(f, /\[0:v\]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30/);
  assert.match(f, /\[1:v\]format=rgba/);
  assert.match(f, /overlay=0:0:format=auto/);
});

test('sai sem áudio (a voz entra depois pelo mixer do projeto) e com a duração da animação', () => {
  const a = argsComporSobreVideo(o);
  assert.ok(a.includes('-an'));
  assert.equal(a[a.indexOf('-t') + 1], '12.500');
  assert.equal(a.at(-1), 'out.mp4');
  assert.deepEqual(a.slice(a.indexOf('-i'), a.indexOf('-i') + 2), ['-i', o.fundo]);
  assert.ok(!a.includes('-ss'));
});

test('render que pula o começo também pula o começo do vídeo de fundo', () => {
  const a = argsComporSobreVideo({ ...o, inicio: 2 });
  assert.deepEqual(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 3), ['-ss', '2.000', '-i']);
});
