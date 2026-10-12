// Transcrição local com tempo por palavra (Whisper via faster-whisper / whisper-ctranslate2).
// Roda offline na CPU; o modelo (~480 MB) é baixado no primeiro uso.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sondar } from './ffmpeg.js';

function rodar(args, sinal) {
  return new Promise((ok, falha) => {
    const p = spawn('uvx', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HF_HUB_DISABLE_SYMLINKS_WARNING: '1', PYTHONIOENCODING: 'utf-8' },
    });
    let err = '';
    p.stdout.on('data', () => {});
    p.stderr.on('data', (d) => { err += d; if (err.length > 30_000) err = err.slice(-15_000); });
    sinal?.addEventListener('abort', () => p.kill());
    p.on('error', (e) => falha(e.code === 'ENOENT' ? new Error('Preciso do "uv" instalado para transcrever (https://docs.astral.sh/uv/).') : e));
    p.on('close', (code) => (code === 0 ? ok() : falha(new Error(err.split('\n').filter(Boolean).slice(-6).join('\n')))));
  });
}

/** Agrupa palavras em frases curtas: quebra em pontuação, pausa > 0,35 s ou 7 palavras. */
function agruparFrases(palavras) {
  const frases = [];
  let atual = null;
  for (const w of palavras) {
    if (!atual) atual = { inicio: w.inicio, fim: w.fim, palavras: [] };
    else if (w.inicio - atual.fim > 0.35 || atual.palavras.length >= 7) {
      frases.push(atual);
      atual = { inicio: w.inicio, fim: w.fim, palavras: [] };
    }
    atual.palavras.push(w.p);
    atual.fim = w.fim;
    if (/[.!?;:,]$/.test(w.p) && atual.palavras.length >= 2) { frases.push(atual); atual = null; }
  }
  if (atual) frases.push(atual);
  return frases.map((f) => ({ inicio: +f.inicio.toFixed(2), fim: +f.fim.toFixed(2), texto: f.palavras.join(' ') }));
}

/**
 * Transcreve um arquivo de áudio/vídeo.
 * Devolve { duracao, texto, frases: [{inicio, fim, texto}], palavras: [{inicio, fim, p}] }
 */
export async function transcrever({ arquivo, pastaTemp, idioma = 'pt', dica = '', modelo = 'small', sinal }) {
  const saidaDir = path.join(pastaTemp, `stt-${Date.now()}`);
  await fs.mkdir(saidaDir, { recursive: true });
  try {
    const args = ['whisper-ctranslate2', arquivo, '--model', modelo, '--device', 'cpu', '--compute_type', 'int8',
      '--word_timestamps', 'True', '--output_format', 'json', '--output_dir', saidaDir];
    if (idioma) args.push('--language', idioma);
    if (dica) args.push('--initial_prompt', dica.slice(0, 400));
    await rodar(args, sinal);
    const [arqJson] = (await fs.readdir(saidaDir)).filter((f) => f.endsWith('.json'));
    if (!arqJson) throw new Error('A transcrição não gerou resultado.');
    const j = JSON.parse(await fs.readFile(path.join(saidaDir, arqJson), 'utf8'));
    const palavras = (j.segments || []).flatMap((s) => (s.words || []).map((w) => ({
      inicio: +(+w.start).toFixed(2), fim: +(+w.end).toFixed(2), p: String(w.word).trim(),
    }))).filter((w) => w.p);
    return {
      duracao: (await sondar(arquivo)).duracao,
      texto: String(j.text || '').trim(),
      frases: agruparFrases(palavras),
      palavras,
    };
  } finally {
    await fs.rm(saidaDir, { recursive: true, force: true });
  }
}

/** Bloco de texto com a linha do tempo da fala, para mandar ao Claude. */
export function linhaDoTempoDaFala(t, deslocamento = 0) {
  const d = (x) => (x + deslocamento).toFixed(2);
  return [
    `Duração do áudio: ${t.duracao.toFixed(2)}s${deslocamento ? ` (começa em ${deslocamento.toFixed(2)}s do vídeo)` : ''}.`,
    'Frases faladas (segundos no vídeo):',
    ...t.frases.map((f) => `[${d(f.inicio)}–${d(f.fim)}] ${f.texto}`),
    '',
    'Palavras com tempo (para cortes precisos):',
    t.palavras.map((w) => `${d(w.inicio)} ${w.p}`).join(' · '),
  ].join('\n');
}
