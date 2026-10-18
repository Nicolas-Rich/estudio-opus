// Exporta um vídeo sonorizado: soma os efeitos da linha do tempo numa faixa (em JS) e mistura com o
// áudio original do vídeo — os efeitos abaixam sob a fala e o master sai em −14 LUFS (aplicarAudioNoVideo).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FFMPEG } from '../ffmpeg.js';
import { lerPcm, somarFaixa, gravarWav } from '../faixa-itens.js';
import { aplicarAudioNoVideo } from '../audio.js';

/** Faixa WAV com cada clipe { somId, t, volume } no seu tempo; cada som (ou fatia) é lido uma vez. */
export async function montarFaixaEfeitos({ clipes, sons, raiz, duracao, volumeEfeitos = 0.8, saida }) {
  const lidos = new Map();
  const instancias = [];
  for (const c of clipes) {
    const s = sons.get(c.somId);
    if (!s) continue;
    if (!lidos.has(s.id)) {
      const af = s.inicio != null ? `atrim=start=${s.inicio}:end=${s.fim},asetpts=PTS-STARTPTS` : '';
      lidos.set(s.id, await lerPcm(path.join(raiz, s.arquivo), af));
    }
    instancias.push({ pcm: lidos.get(s.id), t: c.t, volume: (c.volume ?? 1) * volumeEfeitos, pan: 0 });
  }
  await gravarWav(somarFaixa(instancias, duracao), saida);
  return saida;
}

function ffmpeg(args) {
  return new Promise((ok, falha) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok() : falha(new Error('ffmpeg: ' + err.slice(-400)))));
  });
}

/** MP4 final: vídeo intacto + áudio original (se houver) + faixa de efeitos, masterizado em −14 LUFS. */
export async function exportarSonorizado({ video, temAudio, faixaEfeitos, saida, pastaTemp }) {
  const original = temAudio ? path.join(pastaTemp, `orig-${Date.now().toString(36)}.wav`) : null;
  try {
    if (original) await ffmpeg(['-i', video, '-vn', '-ac', '2', '-ar', '48000', original]);
    const faixas = [
      ...(original ? [{ arquivo: original, tipo: 'voz', volume: 1 }] : []),
      { arquivo: faixaEfeitos, tipo: 'efeitos', volume: 1 },
    ];
    await aplicarAudioNoVideo(video, faixas, saida);
  } finally {
    if (original) await fs.rm(original, { force: true });
  }
}
