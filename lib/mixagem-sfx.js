// Tratamento e mixagem dos efeitos com acabamento de cinema:
// corte do silêncio inicial (o transiente cai no quadro), EQ por tipo de som, pan estéreo,
// reverb por convolução (resposta ao impulso gerada), cama de ambiência com "silêncios"
// e master com compressão de bus + limitador + loudness.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FFMPEG, sondar } from './ffmpeg.js';
import { cadeiaTatil, variacao } from './som-tatil.js';

function rodar(args) {
  return new Promise((ok, falha) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20_000) err = err.slice(-10_000); });
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok() : falha(new Error('ffmpeg: ' + err.slice(-600)))));
  });
}

/** Resposta ao impulso estéreo (sala grande, ~2,6 s) para o reverb por convolução. Gera uma vez. */
export async function garantirIR(arquivo) {
  if (existsSync(arquivo)) return arquivo;
  await fs.mkdir(path.dirname(arquivo), { recursive: true });
  await rodar(['-y',
    '-f', 'lavfi', '-i', 'anoisesrc=d=2.6:c=pink:r=48000:a=0.6:seed=11',
    '-f', 'lavfi', '-i', 'anoisesrc=d=2.6:c=pink:r=48000:a=0.6:seed=29',
    '-filter_complex', '[0][1]join=inputs=2:channel_layout=stereo,afade=t=out:st=0:d=2.6:curve=exp,highpass=f=180,lowpass=f=7000,adelay=18|24',
    arquivo]);
  return arquivo;
}

// EQ / caráter por categoria
const CARATER = {
  impacto: 'highpass=f=28,equalizer=f=62:t=q:w=1.1:g=3,equalizer=f=3500:t=q:w=1:g=1.5',
  boom: 'highpass=f=25,equalizer=f=55:t=q:w=1:g=4',
  hit: 'highpass=f=35,equalizer=f=90:t=q:w=1:g=2,equalizer=f=4000:t=q:w=1:g=2',
  braam: 'highpass=f=30,equalizer=f=110:t=q:w=1:g=2',
  whoosh: 'highpass=f=110,equalizer=f=7000:t=q:w=1:g=2',
  transicao: 'highpass=f=110,equalizer=f=6500:t=q:w=1:g=2',
  riser: 'highpass=f=80,equalizer=f=5000:t=q:w=1:g=1.5',
  reverse: 'highpass=f=90',
  swell: 'highpass=f=70',
  ui: 'highpass=f=280,equalizer=f=4200:t=q:w=1:g=1.5',
  glitch: 'highpass=f=200',
  textura: 'highpass=f=180,aexciter=amount=2:freq=6500',
  stinger: 'highpass=f=30,aexciter=amount=1.5:freq=6000,extrastereo=m=1.25',
  foley: 'highpass=f=60',
  ambiente: 'highpass=f=40,lowpass=f=12000,extrastereo=m=1.3',
};

/**
 * Prepara um som: corta o silêncio do começo e do fim (para alinhar exato), aplica caráter, pan,
 * volume e reverb. Devolve { arquivo, duracaoSeca, duracao } — duracaoSeca é o som sem a cauda do reverb.
 * tatil: clique/tecla/caneta/papel — cadeia "quase ASMR" e seco (sem reverb), em qualquer estilo.
 */
export async function processarSom({ entrada, saida, categoria, pan = 0, reverb = 0, volume = 1, ir, tatil = false }) {
  const seco = saida.replace(/\.wav$/i, '-seco.wav');
  const formato = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  // 1) recorta silêncios das pontas. A ambiência é uma cama contínua (às vezes um room tone bem baixinho,
  //    abaixo do limiar): não corta, só leva a um nível padrão para o volume do plano valer igual para todas.
  await rodar(['-y', '-i', entrada, '-af', categoria === 'ambiente'
    ? `${formato},loudnorm=I=-22:TP=-3:LRA=11,aresample=48000`
    : `${formato},silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.004,`
      + 'areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.03,areverse',
  seco]);
  let duracaoSeca = (await sondar(seco)).duracao || 0;
  if (duracaoSeca < 0.05) {
    // o corte apagou o som inteiro (era todo mais baixo que o limiar): usa o som sem corte
    await rodar(['-y', '-i', entrada, '-af', formato, seco]);
    duracaoSeca = (await sondar(seco)).duracao || 0.1;
  }
  // 2) caráter + pan + volume + reverb
  const car = tatil ? cadeiaTatil() : CARATER[categoria] || 'highpass=f=30';
  if (tatil) reverb = 0;
  const p = Math.max(-1, Math.min(1, +pan || 0)).toFixed(2);
  const base = `[0:a]${car},stereotools=balance_out=${p},volume=${(+volume || 1).toFixed(3)}`;
  if (reverb > 0.02 && ir) {
    await rodar(['-y', '-i', seco, '-i', ir, '-filter_complex',
      `${base},asplit[d][w];[w]apad=pad_dur=2.8[wp];[wp][1:a]afir=dry=1:wet=1:gtype=2[rev];`
      + `[d][rev]amix=inputs=2:weights='1 ${(reverb * 0.55).toFixed(3)}':normalize=0:duration=longest,`
      + 'areverse,silenceremove=start_periods=1:start_threshold=-65dB:start_silence=0.05,areverse[s]',
      '-map', '[s]', '-ar', '48000', saida]);
  } else {
    await rodar(['-y', '-i', seco, '-filter_complex', `${base}[s]`, '-map', '[s]', '-ar', '48000', saida]);
  }
  await fs.rm(seco, { force: true });
  return { arquivo: saida, duracaoSeca, duracao: (await sondar(saida)).duracao };
}

/** Onde o som começa na linha do tempo, segundo o alinhamento pedido. */
export function posicionar(t, alinhar, duracaoSeca) {
  const ini = alinhar === 'fim' ? t - duracaoSeca : alinhar === 'centro' ? t - duracaoSeca / 2 : t;
  return { inicio: Math.max(0, ini), cortarInicio: Math.max(0, -ini) };
}

/**
 * Mixa a sonoplastia: trechos [{ arquivo, inicio, cortarInicio, tatil }] + ambiente { arquivo, volume, silencios }.
 * Um som tátil que se repete ganha uma variação mínima de tom e volume a cada vez (soa humano, não "metralhadora").
 * Master: compressão de bus + limitador + loudness (−20 LUFS, abaixo da voz).
 */
export async function mixarSonorizacao({ trechos, ambiente, duracao, saida, pastaTemp }) {
  const args = ['-y'];
  const filtros = [];
  const camadas = [];
  const repeticoes = new Map();
  trechos.forEach((t, i) => {
    args.push('-i', t.arquivo);
    const ms = Math.round(t.inicio * 1000);
    let f = `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`;
    if (t.cortarInicio > 0) f += `,atrim=start=${t.cortarInicio.toFixed(3)},asetpts=PTS-STARTPTS`;
    if (t.tatil) {
      const n = repeticoes.get(t.arquivo) || 0;
      repeticoes.set(t.arquivo, n + 1);
      const v = variacao(n);
      if (n) f += `,asetrate=${Math.round(48000 * v.tom)},aresample=48000,volume=${v.ganhoDb.toFixed(2)}dB`;
    }
    filtros.push(`${f},adelay=${ms}|${ms}[t${i}]`);
    camadas.push(`[t${i}]`);
  });
  // ambiência sem áudio nenhum não entra: em loop infinito ela nunca chegaria à duração e o ffmpeg travaria
  if (ambiente?.arquivo && !((await sondar(ambiente.arquivo)).duracao > 0.2)) ambiente = null;
  if (ambiente?.arquivo) {
    const k = trechos.length;
    args.push('-stream_loop', '-1', '-i', ambiente.arquivo);
    const sil = (ambiente.silencios || []).map((s) => `between(t,${s.inicio.toFixed(2)},${s.fim.toFixed(2)})`).join('+');
    let f = `[${k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${duracao.toFixed(3)},${CARATER.ambiente}`
      + `,volume=${(+ambiente.volume || 0.15).toFixed(3)},afade=t=in:st=0:d=1.2,afade=t=out:st=${Math.max(0, duracao - 2).toFixed(2)}:d=2`;
    if (sil) f += `,volume='if(${sil},0.06,1)':eval=frame`;
    filtros.push(`${f}[amb]`);
    camadas.push('[amb]');
  }
  if (!camadas.length) throw new Error('Nada para mixar.');
  // bus: compressão leve só para "colar" (ataque lento preserva o transiente dos impactos)
  filtros.push(`${camadas.join('')}amix=inputs=${camadas.length}:duration=longest:dropout_transition=0:normalize=0,`
    + 'acompressor=threshold=-16dB:ratio=2:attack=25:release=250:makeup=1,'
    + `apad=whole_dur=${duracao.toFixed(3)},atrim=duration=${(duracao + 1.5).toFixed(3)}[saida]`);
  const script = path.join(pastaTemp, `mix-${Date.now()}.txt`);
  const bruto = saida.replace(/\.wav$/i, '-bus.wav');
  await fs.writeFile(script, filtros.join(';\n'), 'utf8');
  try {
    await rodar([...args, '-filter_complex_script', script, '-map', '[saida]', '-ac', '2', '-ar', '48000', bruto]);
  } finally {
    await fs.rm(script, { force: true });
  }
  // loudness LINEAR em duas passadas: mede e aplica um ganho fixo (mantém a dinâmica silêncio × impacto)
  const lufs = await medirLufs(bruto);
  const ganho = Number.isFinite(lufs) ? Math.max(-20, Math.min(20, -20 - lufs)) : 0;
  await rodar(['-y', '-i', bruto, '-af', `volume=${ganho.toFixed(2)}dB,alimiter=limit=0.89:attack=2:release=60:level=disabled`, '-ar', '48000', saida]);
  await fs.rm(bruto, { force: true });
}

/** Loudness integrada (LUFS) de um arquivo. */
function medirLufs(arquivo) {
  return new Promise((ok) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostats', '-i', arquivo, '-af', 'ebur128', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => ok(NaN));
    p.on('close', () => {
      const m = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(err);
      ok(m ? +m[1] : NaN);
    });
  });
}
