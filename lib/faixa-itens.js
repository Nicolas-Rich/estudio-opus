// Faixa "itens": soma em JavaScript todos os sons de item (pode passar de 100 num vídeo) numa faixa
// WAV só — sem limite de entradas no ffmpeg. Cada nota/deslize é sintetizado uma vez; cada textura é
// lida uma vez por variação (as repetições variam um tiquinho de tom e volume, como gente de verdade).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FFMPEG } from './ffmpeg.js';
import { frequenciaDaNota, sintetizarTom, sintetizarDeslize } from './sintese-tons.js';
import { variacao } from './som-tatil.js';

const SR = 48000;
const VARIANTES = 8; // repetições de uma textura ciclam entre 8 variações

/** PCM float estéreo 48 kHz de um arquivo; af: filtro opcional na leitura. */
export function lerPcm(arquivo, af = '') {
  return new Promise((ok, falha) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-i', arquivo];
    if (af) args.push('-af', af);
    args.push('-ac', '2', '-ar', String(SR), '-f', 'f32le', '-');
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const partes = [];
    let err = '';
    p.stdout.on('data', (d) => partes.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', falha);
    p.on('close', (c) => {
      if (c !== 0) return falha(new Error('ffmpeg (leitura): ' + err.slice(-400)));
      const b = Buffer.concat(partes);
      const x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 8)));
      const L = new Float32Array(x.length / 2), R = new Float32Array(x.length / 2);
      for (let i = 0; i < L.length; i++) { L[i] = x[2 * i]; R[i] = x[2 * i + 1]; }
      ok([L, R]);
    });
  });
}

/** Soma os sons na linha do tempo, com volume e pan de potência constante. */
export function somarFaixa(instancias, duracao) {
  const n = Math.round(duracao * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const { pcm, t, volume, pan } of instancias) {
    const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
    const gl = Math.cos(a) * volume, gr = Math.sin(a) * volume;
    const ini = Math.round(t * SR);
    const fim = Math.min(n, ini + pcm[0].length);
    for (let i = Math.max(0, ini); i < fim; i++) {
      L[i] += pcm[0][i - ini] * gl;
      R[i] += pcm[1][i - ini] * gr;
    }
  }
  return [L, R];
}

/** WAV PCM 16-bit estéreo 48 kHz. */
export async function gravarWav([L, R], arquivo) {
  const n = L.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  const q = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  for (let i = 0; i < n; i++) { b.writeInt16LE(q(L[i]), 44 + i * 4); b.writeInt16LE(q(R[i]), 46 + i * 4); }
  await fs.writeFile(arquivo, b);
}

/**
 * instancias: saída de mapearItens. kit: { escala, timbre }. sons: { tum?, saida?, tique? } (arquivos tratados).
 * Devolve { arquivo, total }.
 */
export async function montarFaixaItens({ instancias, kit, sons = {}, pasta, duracao, saida }) {
  const timbre = kit?.timbre || 'soft_fm';
  const cache = new Map();
  const carregar = async (chave, criar) => {
    if (!cache.has(chave)) cache.set(chave, criar());
    return cache.get(chave);
  };
  const nota = (grau) => frequenciaDaNota(kit.escala, grau);
  const repeticoes = {};
  const prontas = [];
  for (const i of instancias) {
    let pcm = null;
    if (i.som === 'tom') {
      const f = nota(i.grau);
      const arq = path.join(pasta, `tom-${timbre}-${f.toFixed(1)}.wav`);
      pcm = await carregar(arq, async () => { if (!existsSync(arq)) await sintetizarTom({ freq: f, timbre, saida: arq }); return lerPcm(arq); });
    } else if (i.som === 'deslize') {
      const de = nota(i.grau), ate = nota(i.ate);
      const arq = path.join(pasta, `deslize-${timbre}-${de.toFixed(1)}-${ate.toFixed(1)}.wav`);
      pcm = await carregar(arq, async () => { if (!existsSync(arq)) await sintetizarDeslize({ de, ate, timbre, saida: arq }); return lerPcm(arq); });
    } else if (sons[i.som]) {
      const n = (repeticoes[i.som] = (repeticoes[i.som] ?? -1) + 1) % VARIANTES;
      const v = variacao(n);
      const af = n ? `asetrate=${Math.round(SR * v.tom)},aresample=${SR},volume=${v.ganhoDb.toFixed(2)}dB` : '';
      pcm = await carregar(`${sons[i.som]}#${n}`, () => lerPcm(sons[i.som], af));
    }
    if (pcm) prontas.push({ pcm, t: i.t, volume: i.volume, pan: i.pan });
  }
  await gravarWav(somarFaixa(prontas, duracao), saida);
  return { arquivo: saida, total: prontas.length };
}
