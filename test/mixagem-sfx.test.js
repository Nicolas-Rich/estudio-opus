import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FFMPEG, sondar } from '../lib/ffmpeg.js';
import { processarSom, mixarSonorizacao } from '../lib/mixagem-sfx.js';

const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'mixagem-sfx-'));
const gerar = (nome, ...args) => {
  const arq = path.join(pasta, nome);
  spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args, arq]);
  return arq;
};
// room tone bem baixinho (pico ~ −60 dB), como a ElevenLabs às vezes devolve
const quieto = gerar('quieto.wav', '-f', 'lavfi', '-i', 'anoisesrc=d=4:c=pink:r=48000:a=0.001', '-ac', '2');
const impacto = gerar('impacto.wav', '-f', 'lavfi', '-i', 'sine=f=80:d=0.5:r=48000', '-ac', '2');

test('ambiência baixinha não some no corte de silêncio', async () => {
  const r = await processarSom({ entrada: quieto, saida: path.join(pasta, 'amb.wav'), categoria: 'ambiente' });
  assert.ok(r.duracao > 3.5, `ambiência ficou com ${r.duracao}s`);
});

test('som que o corte apagaria inteiro volta sem corte', async () => {
  const r = await processarSom({ entrada: quieto, saida: path.join(pasta, 'ui.wav'), categoria: 'ui' });
  assert.ok(r.duracao > 3.5, `som ficou com ${r.duracao}s`);
});

test('ambiência vazia (só cabeçalho) não trava a mixagem', { timeout: 20_000 }, async () => {
  const vazio = gerar('vazio.wav', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0');
  const saida = path.join(pasta, 'mix.wav');
  await mixarSonorizacao({
    trechos: [{ arquivo: impacto, inicio: 0.5, cortarInicio: 0 }],
    ambiente: { arquivo: vazio, volume: 0.1, silencios: [] },
    duracao: 3, saida, pastaTemp: pasta,
  });
  assert.ok((await sondar(saida)).duracao >= 3);
});
