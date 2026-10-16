// Edição IA: prepara os vídeos enviados — normaliza, emenda na ordem, transcreve, acha silêncios e tira quadros.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FFMPEG, sondar } from '../ffmpeg.js';
import { transcrever } from '../transcricao.js';
import { analisarVideo } from '../analise-video.js';
import { candidatosDeCorte } from './cortes.js';

const W = 1080;
const H = 1920;
const FPS = 30;

/** Argumentos do ffmpeg para deixar um vídeo em 1080×1920, 30 fps, AAC 48 kHz estéreo (cobrindo, sem esticar). */
export function argsNormalizar({ entrada, saida, temAudio }) {
  return [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', entrada,
    ...(temAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p`,
    '-map', '0:v:0', '-map', temAudio ? '0:a:0' : '1:a:0',
    // áudio alinhado ao vídeo: começa em 0 e é completado com silêncio até o fim do vídeo
    ...(temAudio ? ['-af', 'aresample=async=1:first_pts=0,apad'] : []),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-shortest',
    '-movflags', '+faststart', saida,
  ];
}

/** Conteúdo do arquivo de lista do concat demuxer, com caminhos escapados. */
export function listaConcat(arquivos) {
  return arquivos.map((a) => `file '${a.replace(/\\/g, '/').replace(/'/g, "'\\''")}'\n`).join('');
}

/** Intervalos de silêncio a partir da saída do filtro silencedetect. */
export function lerSilencios(stderr, duracao = Infinity) {
  const out = [];
  let inicio = null;
  for (const linha of String(stderr).split(/\r?\n/)) {
    const a = /silence_start:\s*(-?[\d.]+)/.exec(linha);
    if (a) { inicio = Math.max(0, +a[1]); continue; }
    const b = /silence_end:\s*([\d.]+)/.exec(linha);
    if (b && inicio != null) { out.push({ inicio, fim: +b[1] }); inicio = null; }
  }
  if (inicio != null && Number.isFinite(duracao)) out.push({ inicio, fim: duracao });
  return out;
}

function ffmpeg(args, { cwd, sinal } = {}) {
  return new Promise((ok, falha) => {
    const p = spawn(FFMPEG, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 400_000) err = err.slice(-200_000); });
    sinal?.addEventListener('abort', () => p.kill());
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok(err) : falha(new Error('ffmpeg: ' + err.split('\n').filter(Boolean).slice(-6).join('\n')))));
  });
}

/**
 * Prepara a edição na pasta: fontes/NN.mp4, base.mp4, segmentos.json, transcricao.json, silencios.json, quadros/.
 * fontes: caminhos dos vídeos enviados, na ordem escolhida.
 */
export async function prepararEdicao({ pasta, fontes, sinal, progresso = () => {} }) {
  if (!fontes.length) throw new Error('Envie pelo menos um vídeo.');
  const dirFontes = path.join(pasta, 'fontes');
  await fs.rm(dirFontes, { recursive: true, force: true });
  await fs.mkdir(dirFontes, { recursive: true });

  const normalizados = [];
  for (const [i, f] of fontes.entries()) {
    progresso(0.05 + (0.35 * i) / fontes.length, `Ajustando o vídeo ${i + 1} de ${fontes.length}…`);
    const info = await sondar(f);
    if (!info.largura) throw new Error(`"${path.basename(f)}" não tem imagem de vídeo.`);
    const saida = path.join(dirFontes, `${String(i + 1).padStart(2, '0')}.mp4`);
    await ffmpeg(argsNormalizar({ entrada: f, saida, temAudio: info.temAudio }), { sinal });
    normalizados.push(saida);
  }

  progresso(0.42, 'Emendando os vídeos na ordem…');
  const base = path.join(pasta, 'base.mp4');
  await fs.writeFile(path.join(pasta, 'lista.txt'), listaConcat(normalizados), 'utf8');
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-c', 'copy', '-movflags', '+faststart', 'base.mp4'], { cwd: pasta, sinal });

  const segmentos = [];
  let acc = 0;
  for (const f of normalizados) {
    const d = (await sondar(f)).duracao;
    segmentos.push({ fonte: path.basename(f), inicio: +acc.toFixed(3), fim: +(acc + d).toFixed(3) });
    acc += d;
  }
  const duracao = (await sondar(base)).duracao;

  progresso(0.5, 'Procurando pausas…');
  const stderr = await ffmpeg(['-hide_banner', '-i', base, '-af', 'silencedetect=n=-35dB:d=0.4', '-f', 'null', '-'], { sinal });
  const silencios = lerSilencios(stderr, duracao);

  progresso(0.55, 'Transcrevendo a fala (Whisper, no seu PC)…');
  const transcricao = await transcrever({ arquivo: base, pastaTemp: pasta, idioma: 'pt', sinal });

  progresso(0.85, 'Olhando os quadros do vídeo…');
  const { folhas } = await analisarVideo({ video: base, pasta: path.join(pasta, 'quadros'), duracao });

  const candidatos = candidatosDeCorte({ palavras: transcricao.palavras, silencios, duracao });
  const gravar = (nome, dado) => fs.writeFile(path.join(pasta, nome), JSON.stringify(dado, null, 1), 'utf8');
  await Promise.all([gravar('segmentos.json', segmentos), gravar('transcricao.json', transcricao), gravar('silencios.json', silencios)]);
  progresso(1, 'Vídeos preparados.');
  return { duracao, segmentos, transcricao, silencios, folhas, candidatos };
}
