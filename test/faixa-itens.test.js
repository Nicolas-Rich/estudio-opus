import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sondar } from '../lib/ffmpeg.js';
import { lerPcm, somarFaixa, gravarWav, montarFaixaItens } from '../lib/faixa-itens.js';

const SR = 48000;
const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'faixa-itens-'));
const pulso = (n = 10) => { const c = new Float32Array(n).fill(1); return [c, Float32Array.from(c)]; };
const picoEm = (x) => { let k = 0; for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[k])) k = i; return k; };

test('soma: o pulso cai no tempo certo, do lado do pan, e a faixa tem a duração exata', () => {
  const [L, R] = somarFaixa([{ pcm: pulso(), t: 0.5, volume: 1, pan: -0.6 }], 2);
  assert.equal(L.length, 2 * SR);
  assert.equal(R.length, 2 * SR);
  assert.ok(Math.abs(picoEm(L) - 24000) <= 1, `pico em ${picoEm(L)}`);
  assert.ok(L[24000] > R[24000]);
});

test('pan de potência constante', () => {
  for (const pan of [-0.6, 0, 0.6]) {
    const [L, R] = somarFaixa([{ pcm: pulso(), t: 0, volume: 1, pan }], 0.01);
    assert.ok(Math.abs(L[0] - Math.cos(((pan + 1) * Math.PI) / 4)) < 1e-6, `L pan ${pan}`);
    assert.ok(Math.abs(R[0] - Math.sin(((pan + 1) * Math.PI) / 4)) < 1e-6, `R pan ${pan}`);
  }
});

test('som que passa do fim é cortado sem erro', () => {
  const [L] = somarFaixa([{ pcm: pulso(SR), t: 0.9, volume: 1, pan: 0 }], 1);
  assert.equal(L.length, SR);
});

test('gravar e ler de volta mantém a duração', async () => {
  const arq = path.join(pasta, 'ida-volta.wav');
  await gravarWav(somarFaixa([{ pcm: pulso(), t: 0.2, volume: 0.5, pan: 0 }], 1.5), arq);
  const [L, R] = await lerPcm(arq);
  assert.ok(Math.abs(L.length - 1.5 * SR) <= 1 && R.length === L.length, `${L.length}`);
});

test('vídeo longo: 600 sons em 120 s somam em menos de 2 s', () => {
  const som = [new Float32Array(0.3 * SR).fill(0.1), new Float32Array(0.3 * SR).fill(0.1)];
  const inst = Array.from({ length: 600 }, (_, k) => ({ pcm: som, t: k * 0.2, volume: 0.3, pan: 0 }));
  const t0 = performance.now();
  const [L] = somarFaixa(inst, 120);
  assert.ok(performance.now() - t0 < 2000);
  assert.equal(L.length, 120 * SR);
});

test('monta a faixa de itens com tons sintetizados (sem texturas)', async () => {
  const kit = { escala: { tonica: 'A', modo: 'pentatonica_maior', oitava: 5 }, timbre: 'soft_fm' };
  const instancias = [
    { t: 0.2, som: 'tom', grau: 0, volume: 0.3, pan: 0 },
    { t: 0.4, som: 'tom', grau: 1, volume: 0.3, pan: 0.3 },
    { t: 0.6, som: 'tom', grau: 0, volume: 0.3, pan: -0.3 },
    { t: 0.9, som: 'deslize', grau: 0, ate: 2, volume: 0.3, pan: 0 },
  ];
  const saida = path.join(pasta, 'itens.wav');
  const r = await montarFaixaItens({ instancias, kit, sons: {}, pasta, duracao: 2, saida });
  assert.equal(r.total, 4);
  assert.ok(Math.abs((await sondar(saida)).duracao - 2) < 0.01);
  const tons = (await fs.readdir(pasta)).filter((n) => n.startsWith('tom-'));
  assert.equal(tons.length, 2, 'cada nota é sintetizada uma vez só');
});
