// Motores de áudio: vozes (Piper offline, Windows, ElevenLabs), efeitos (ElevenLabs,
// biblioteca local, síntese em código via Web Audio) e mixagem com ffmpeg.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { FFMPEG } from './ffmpeg.js';
import { normalizarFala } from './texto-fala.js';

export const hash = (...partes) => createHash('sha1').update(JSON.stringify(partes)).digest('hex').slice(0, 16);

function rodar(bin, args, { entrada, env } = {}) {
  return new Promise((ok, falha) => {
    const p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env: env || process.env });
    let err = '';
    p.stdout.on('data', () => {});
    p.stderr.on('data', (d) => { err += d; if (err.length > 50_000) err = err.slice(-20_000); });
    p.on('error', (e) => falha(e.code === 'ENOENT' ? new Error(`Programa não encontrado: ${bin}`) : e));
    p.on('close', (code) => (code === 0 ? ok() : falha(new Error(err.split('\n').slice(-8).join('\n') || `${bin} saiu com código ${code}`))));
    p.stdin.end(entrada ?? '', 'utf8');
  });
}

// ------------------------------------------------------------------ Piper (offline)
const PIPER_VOZES = [
  { id: 'pt_BR-faber-medium', nome: 'Faber (masculina, pt-BR)', caminho: 'pt/pt_BR/faber/medium' },
  { id: 'pt_BR-cadu-medium', nome: 'Cadu (masculina, pt-BR)', caminho: 'pt/pt_BR/cadu/medium' },
  { id: 'pt_BR-jeff-medium', nome: 'Jeff (masculina, pt-BR)', caminho: 'pt/pt_BR/jeff/medium' },
  { id: 'pt_BR-edresson-low', nome: 'Edresson (masculina, pt-BR, leve)', caminho: 'pt/pt_BR/edresson/low' },
  { id: 'en_US-lessac-medium', nome: 'Lessac (feminina, inglês)', caminho: 'en/en_US/lessac/medium' },
  { id: 'es_ES-davefx-medium', nome: 'Davefx (masculina, espanhol)', caminho: 'es/es_ES/davefx/medium' },
];
const HF_PIPER = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

async function baixar(url, destino) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao baixar ${url} (${r.status})`);
  const tmp = destino + '.parcial';
  await fs.writeFile(tmp, Buffer.from(await r.arrayBuffer()));
  await fs.rename(tmp, destino);
}

async function falarPiper({ voz, texto, velocidade, saida, pastaVozes }) {
  const v = PIPER_VOZES.find((x) => x.id === voz) || PIPER_VOZES[0];
  const pasta = path.join(pastaVozes, 'piper');
  await fs.mkdir(pasta, { recursive: true });
  const modelo = path.join(pasta, `${v.id}.onnx`);
  if (!existsSync(modelo)) await baixar(`${HF_PIPER}/${v.caminho}/${v.id}.onnx`, modelo);
  if (!existsSync(modelo + '.json')) await baixar(`${HF_PIPER}/${v.caminho}/${v.id}.onnx.json`, modelo + '.json');
  const escala = (1 / Math.min(1.6, Math.max(0.6, velocidade || 1))).toFixed(3);
  await rodar('uvx', ['--from', 'piper-tts', 'piper', '-m', modelo, '-f', saida, '--length-scale', escala, '--sentence-silence', '0.15'],
    { entrada: texto });
}

// ------------------------------------------------------------------ Windows (SAPI)
async function vozesWindows() {
  const script = 'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture + "|" + $_.VoiceInfo.Gender }';
  return new Promise((ok) => {
    const p = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => ok([]));
    p.on('close', () => ok(out.trim().split(/\r?\n/).filter(Boolean).map((l) => {
      const [nome, cultura, genero] = l.split('|');
      return { id: nome, nome: `${nome.replace('Microsoft ', '').replace(' Desktop', '')} (${genero === 'Female' ? 'feminina' : 'masculina'}, ${cultura})` };
    })));
  });
}

async function falarWindows({ voz, texto, velocidade, saida, pastaTemp }) {
  const arqTexto = path.join(pastaTemp, `fala-${Date.now()}.txt`);
  await fs.writeFile(arqTexto, texto, 'utf8');
  const taxa = Math.round(Math.min(10, Math.max(-10, ((velocidade || 1) - 1) * 10)));
  const script = 'Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; '
    + 'if ($env:VOZ) { $s.SelectVoice($env:VOZ) }; $s.Rate = [int]$env:TAXA; $s.SetOutputToWaveFile($env:SAIDA); '
    + '$s.Speak([IO.File]::ReadAllText($env:TEXTO, [Text.Encoding]::UTF8)); $s.Dispose()';
  try {
    await rodar('powershell', ['-NoProfile', '-Command', script], {
      env: { ...process.env, VOZ: voz || '', TAXA: String(taxa), SAIDA: saida, TEXTO: arqTexto },
    });
  } finally {
    await fs.rm(arqTexto, { force: true });
  }
}

// ------------------------------------------------------------------ ElevenLabs
const EL = 'https://api.elevenlabs.io';
async function el(caminho, chave, opcoes = {}) {
  if (!chave) throw new Error('Configure a chave da ElevenLabs em ⚙ Configurações.');
  const r = await fetch(EL + caminho, {
    ...opcoes,
    headers: { 'xi-api-key': chave, ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}), ...(opcoes.headers || {}) },
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const j = await r.json(); msg = j.detail?.message || j.detail?.status || JSON.stringify(j.detail || j).slice(0, 300); } catch {}
    throw new Error(`ElevenLabs: ${msg}`);
  }
  return r;
}

export async function elevenAssinatura(chave) {
  const j = await (await el('/v1/user/subscription', chave)).json();
  return { plano: j.tier, usados: j.character_count, limite: j.character_limit, renova: j.next_character_count_reset_unix };
}

// Vozes padrão (premade) da ElevenLabs: usadas quando a chave não tem "Voices → Read".
// Todas falam português com os modelos multilíngues.
const VOZES_PADRAO_ELEVEN = [
  ['EXAVITQu4vr4xnSDxMaL', 'Sarah (feminina, suave)'], ['FGY2WhTYpPnrIDTdsKH5', 'Laura (feminina, animada)'],
  ['XrExE9yKIg1WjnnlVkGX', 'Matilda (feminina, calorosa)'], ['cgSgspJ2msm6clMCkdW9', 'Jessica (feminina, expressiva)'],
  ['Xb7hH8MSUJpSbSDYk0k2', 'Alice (feminina, confiante)'], ['pFZP5JQG7iQjIQuC4Bku', 'Lily (feminina, aveludada)'],
  ['9BWtsMINqrJLrRacOk9x', 'Aria (feminina, expressiva)'], ['XB0fDUnXU5powFXDhCwa', 'Charlotte (feminina, sedutora)'],
  ['TX3LPaxmHKxFdv7VOQHJ', 'Liam (masculina, articulada)'], ['nPczCjzI2devNBz1zQrb', 'Brian (masculina, grave)'],
  ['JBFqnCBsd6RMkjVDRZzb', 'George (masculina, narrador)'], ['IKne3meq5aSn9XLyUdCD', 'Charlie (masculina, natural)'],
  ['cjVigY5qzO86Huf0OWal', 'Eric (masculina, amigável)'], ['iP95p4xoKVk53GoZ742B', 'Chris (masculina, casual)'],
  ['onwK4e9ZLuTAKqWW03F9', 'Daniel (masculina, locutor)'], ['bIHbv24MWmeRgasZH58o', 'Will (masculina, amigável)'],
  ['N2lVS1w4EtoT3dr4eOWO', 'Callum (masculina, intensa)'], ['CwhRBWXzGAHq8TQ4Fs17', 'Roger (masculina, confiante)'],
  ['pqHfZKP75CvOlQylNhV4', 'Bill (masculina, madura)'], ['SAz9YHcvj6GT2YYXdXww', 'River (neutra, calma)'],
].map(([id, rotulo]) => {
  const [, nome, info] = /^(.*?) \((.*)\)$/.exec(rotulo);
  return { id, nome, info: info.replace(/, /g, ' · ') + ' · sotaque inglês', grupo: 'Vozes padrão — falam português com sotaque estrangeiro' };
});
export const MODELO_ELEVEN_PADRAO = 'eleven_v4';
const MODELOS_PADRAO_ELEVEN = [
  { id: 'eleven_v4', nome: 'Eleven v4 (mais expressivo, padrão)' },
  { id: 'eleven_v4_turbo', nome: 'Eleven v4 Turbo (rápido)' },
  { id: 'eleven_multilingual_v2', nome: 'Eleven Multilingual v2' },
  { id: 'eleven_v3', nome: 'Eleven v3 (mais expressivo)' },
  { id: 'eleven_turbo_v2_5', nome: 'Eleven Turbo v2.5 (rápido)' },
  { id: 'eleven_flash_v2_5', nome: 'Eleven Flash v2.5 (mais rápido e barato)' },
];
const faltaPermissao = (e) => /permission/i.test(e.message);

const GENERO = { female: 'feminina', male: 'masculina', neutral: 'neutra' };
const descreverVoz = (...partes) => partes.map((p) => GENERO[p] || p).filter(Boolean).map((p) => String(p).replace(/_/g, ' ')).join(' · ');

/**
 * Vozes da ElevenLabs com o nome igual ao do site:
 *  - "Minhas vozes": as da conta (inclui clonadas e as adicionadas da biblioteca)
 *  - "Biblioteca — Português (Brasil)": Voice Library filtrada por sotaque brasileiro
 * Para vozes da biblioteca o id vem como "biblioteca:<public_owner_id>:<voice_id>".
 */
export async function vozesEleven(chave) {
  const minhas = [];
  let token = '';
  for (let pag = 0; pag < 5; pag++) {
    const q = new URLSearchParams({ page_size: '100', ...(token ? { next_page_token: token } : {}) });
    const j = await (await el(`/v2/voices?${q}`, chave)).json();
    for (const v of j.voices || []) {
      const l = v.labels || {};
      minhas.push({
        id: v.voice_id, nome: v.name, grupo: 'Minhas vozes', preview: v.preview_url,
        info: descreverVoz(l.gender, l.age, l.accent, l.descriptive || l.description, l.use_case),
      });
    }
    if (!j.has_more || !j.next_page_token) break;
    token = j.next_page_token;
  }
  const jaTenho = new Set(minhas.map((v) => v.id));
  const biblioteca = [];
  for (let page = 0; page < 3; page++) {
    const q = new URLSearchParams({ language: 'pt', accent: 'brazilian', page_size: '100', page: String(page), sort: 'trending' });
    let j;
    try { j = await (await el(`/v1/shared-voices?${q}`, chave)).json(); } catch (e) { if (page === 0) throw e; break; }
    for (const v of j.voices || []) {
      if (jaTenho.has(v.voice_id)) continue;
      biblioteca.push({
        id: `biblioteca:${v.public_owner_id}:${v.voice_id}`, nome: v.name, grupo: 'Biblioteca ElevenLabs — Português (Brasil)',
        preview: v.preview_url, info: descreverVoz(v.gender, v.age, v.descriptive, v.use_case),
      });
    }
    if (!j.has_more) break;
  }
  return [...minhas, ...biblioteca];
}

export async function modelosEleven(chave) {
  try {
    const j = await (await el('/v1/models', chave)).json();
    const ordem = (id) => (id.startsWith('eleven_v4') ? 0 : id === 'eleven_v3' ? 1 : 2);
    return j.filter((m) => m.can_do_text_to_speech)
      .map((m) => ({ id: m.model_id, nome: m.name }))
      .sort((a, b) => ordem(a.id) - ordem(b.id));
  } catch (e) {
    if (faltaPermissao(e)) return MODELOS_PADRAO_ELEVEN;
    throw e;
  }
}

async function falarEleven({ voz, texto, velocidade, modelo, saida, chave, anterior, proxima, idioma, interpretacao, ajustesVoz }) {
  let voiceId = voz;
  if (voz.startsWith('biblioteca:')) {
    const [, dono, id] = voz.split(':');
    voiceId = id;
    try {
      return await ttsEleven({ voiceId, texto, velocidade, modelo, saida, chave, anterior, proxima, idioma, interpretacao, ajustesVoz });
    } catch (e) {
      if (!/not.?found|does not exist|voice_not_found/i.test(e.message)) throw e;
      // a voz da biblioteca precisa estar na conta: adiciona (ocupa um slot de voz do plano)
      const nomes = (await vozesEleven(chave).catch(() => [])).filter((v) => v.id === voz);
      const r = await el(`/v1/voices/add/${dono}/${id}`, chave, {
        method: 'POST', body: JSON.stringify({ new_name: nomes[0]?.nome || id }),
      });
      voiceId = (await r.json()).voice_id || id;
    }
  }
  return ttsEleven({ voiceId, texto, velocidade, modelo, saida, chave, anterior, proxima, idioma, interpretacao, ajustesVoz });
}

// interpretação: estável (locutor), natural, expressiva (anúncio animado)
const INTERPRETACAO = {
  estavel: { stability: 0.75, style: 0.05 },
  natural: { stability: 0.5, style: 0.2 },
  expressiva: { stability: 0.3, style: 0.45 },
};
// modelos que entendem tags de emoção como [excited] ou [whispers]; nos outros as tags são removidas
export const aceitaTags = (modelo) => /eleven_v[34]/.test(modelo || MODELO_ELEVEN_PADRAO);
async function ttsEleven({ voiceId, texto, velocidade, modelo, saida, chave, anterior, proxima, idioma = 'pt', interpretacao = 'natural', ajustesVoz }) {
  const { similarity_boost: similaridade = 0.8, ...ajuste } = ajustesVoz || INTERPRETACAO[interpretacao] || INTERPRETACAO.natural;
  if (!aceitaTags(modelo)) texto = texto.replace(/\[[^\]\n]{1,40}\]\s*/g, '');
  const corpo = {
    text: texto,
    model_id: modelo || MODELO_ELEVEN_PADRAO,
    // fixa o idioma: evita a voz "chutar" inglês/espanhol em frases curtas
    language_code: idioma || 'pt',
    // contexto das falas vizinhas: entonação contínua entre as frases
    ...(anterior ? { previous_text: anterior } : {}),
    ...(proxima ? { next_text: proxima } : {}),
    voice_settings: { ...ajuste, similarity_boost: similaridade, use_speaker_boost: true, speed: Math.min(1.2, Math.max(0.7, velocidade || 1)) },
  };
  let r;
  try {
    r = await el(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, chave, { method: 'POST', body: JSON.stringify(corpo) });
  } catch (e) {
    // modelo que não aceita idioma/contexto: tenta de novo sem eles
    if (!/language|previous_text|next_text|unsupported|not supported/i.test(e.message)) throw e;
    delete corpo.language_code; delete corpo.previous_text; delete corpo.next_text;
    r = await el(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, chave, { method: 'POST', body: JSON.stringify(corpo) });
  }
  await fs.writeFile(saida, Buffer.from(await r.arrayBuffer()));
}

// reforço por categoria no prompt do gerador de efeitos
const DICA_SFX = {
  impacto: 'hard-hitting, punchy transient, powerful low end',
  boom: 'deep sub bass boom, huge and round',
  hit: 'tight dry hit, sharp transient',
  braam: 'huge cinematic brass braam, dark and wide',
  whoosh: 'fast motion pass-by with doppler, airy',
  transicao: 'smooth transition sweep, motion',
  riser: 'builds tension continuously and ends abruptly',
  reverse: 'reversed swell growing into a hit, ends abruptly',
  swell: 'slow swell growing in intensity',
  ui: 'clean interface sound, crisp, minimal',
  glitch: 'digital glitch, stutter, data artifacts',
  textura: 'subtle detailed texture',
  stinger: 'memorable sonic logo, polished, wide stereo, long tail',
  foley: 'realistic foley recording, close-mic',
  ambiente: 'seamless loopable ambience bed, subtle, immersive',
};

/** Gera um efeito na ElevenLabs. categoria reforça o prompt; loop=true para camas de ambiência. */
export async function efeitoEleven({ descricao, duracao, saida, chave, categoria, loop = false }) {
  const texto = [
    descricao.replace(/\.\s*$/, ''),
    DICA_SFX[categoria] || '',
    'cinematic sound design, high fidelity, studio quality, isolated sound effect, no music, no melody, no voice, no speech',
  ].filter(Boolean).join('. ').slice(0, 450);
  const corpo = { text: texto, duration_seconds: Math.min(30, Math.max(0.5, duracao || 1)), prompt_influence: loop ? 0.4 : 0.55 };
  if (loop) corpo.loop = true;
  let r;
  try {
    r = await el('/v1/sound-generation?output_format=mp3_44100_192', chave, { method: 'POST', body: JSON.stringify(corpo) });
  } catch (e) {
    // plano sem 192 kbps ou modelo sem loop: tenta o formato padrão, sem loop
    if (!/output_format|loop|tier|subscription/i.test(e.message)) throw e;
    delete corpo.loop;
    r = await el('/v1/sound-generation?output_format=mp3_44100_128', chave, { method: 'POST', body: JSON.stringify(corpo) });
  }
  await fs.writeFile(saida, Buffer.from(await r.arrayBuffer()));
}

// ------------------------------------------------------------------ API pública de voz
export const PROVEDORES_VOZ = [
  { id: 'piper', nome: 'Piper — neural, offline, grátis' },
  { id: 'windows', nome: 'Windows — vozes do sistema, offline' },
  { id: 'elevenlabs', nome: 'ElevenLabs — qualidade de estúdio (usa créditos)' },
  { id: 'arquivo', nome: '🎤 Meu áudio gravado (enviar arquivo e sincronizar)' },
];

export async function listarVozes(provedor, cfg) {
  if (provedor === 'arquivo') return [];
  if (provedor === 'piper') return PIPER_VOZES.map(({ id, nome }) => ({ id, nome }));
  if (provedor === 'windows') return vozesWindows();
  if (provedor === 'elevenlabs') {
    try {
      return await vozesEleven(cfg.elevenlabsKey);
    } catch (e) {
      if (!faltaPermissao(e)) throw e;
      return VOZES_PADRAO_ELEVEN; // chave sem "Voices → Read"
    }
  }
  return [];
}

/** Gera uma fala; devolve a extensão do arquivo criado (.wav ou .mp3). */
export async function sintetizarFala({ provedor, ...o }, cfg) {
  // números, preços e símbolos viram palavras (a voz lê "noventa e sete reais", não "R cifrão 97")
  if (!o.textoBruto) {
    o.texto = normalizarFala(o.texto);
    if (o.anterior) o.anterior = normalizarFala(o.anterior);
    if (o.proxima) o.proxima = normalizarFala(o.proxima);
  }
  if (provedor === 'elevenlabs') { await falarEleven({ ...o, chave: cfg.elevenlabsKey }); return; }
  if (provedor === 'windows') return falarWindows(o);
  return falarPiper(o);
}
export const extensaoVoz = (provedor) => (provedor === 'elevenlabs' ? '.mp3' : '.wav');

// ------------------------------------------------------------------ mixagem
/**
 * Junta trechos de áudio em posições de tempo numa faixa .wav estéreo 48 kHz.
 * trechos = [{ arquivo, inicio, volume?, duracao? }]
 * alvoLufs: normaliza a loudness da faixa (voz ≈ -16, efeitos ≈ -20) para os níveis ficarem coerentes.
 */
export async function montarFaixa(trechos, duracaoTotal, saida, { alvoLufs } = {}) {
  if (!trechos.length) throw new Error('Nada para mixar.');
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const filtros = [];
  trechos.forEach((t, i) => {
    args.push('-i', t.arquivo);
    const ms = Math.round(Math.max(0, t.inicio) * 1000);
    let f = `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`;
    if (t.cortarInicio > 0) f += `,atrim=start=${t.cortarInicio.toFixed(3)},asetpts=PTS-STARTPTS`;
    if (t.tempo && Math.abs(t.tempo - 1) > 0.005) f += `,atempo=${t.tempo.toFixed(3)}`;
    if (t.duracao) f += `,atrim=duration=${t.duracao.toFixed(3)},afade=t=out:st=${Math.max(0, t.duracao - 0.08).toFixed(3)}:d=0.08`;
    f += `,volume=${(t.volume ?? 1).toFixed(3)},adelay=${ms}|${ms}[t${i}]`;
    filtros.push(f);
  });
  filtros.push(`${trechos.map((_, i) => `[t${i}]`).join('')}amix=inputs=${trechos.length}:duration=longest:dropout_transition=0:normalize=0,`
    + `${alvoLufs ? `loudnorm=I=${alvoLufs}:TP=-1.5:LRA=11,aresample=48000,` : ''}alimiter=limit=0.95,apad=whole_dur=${duracaoTotal.toFixed(3)}[saida]`);
  args.push('-filter_complex', filtros.join(';'), '-map', '[saida]', '-ar', '48000', '-ac', '2', saida);
  await rodar(FFMPEG, args);
}

/** Normaliza a loudness de um arquivo de áudio no lugar. */
export async function normalizarArquivo(arquivo, alvoLufs) {
  const ext = path.extname(arquivo);
  const tmp = arquivo.slice(0, -ext.length) + '-norm' + ext;
  await rodar(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', arquivo,
    '-af', `loudnorm=I=${alvoLufs}:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.95`, '-ac', '2', tmp]);
  await fs.rename(tmp, arquivo);
}

/**
 * Coloca as faixas de áudio no vídeo (substitui o áudio).
 * faixas = [{ arquivo, volume, deslocamento, tipo }]  deslocamento = segundos a pular no início da faixa
 * Com voz + efeitos, os efeitos abaixam sozinhos enquanto alguém fala (ducking por sidechain).
 */
export async function aplicarAudioNoVideo(video, faixas, saida) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', video];
  const filtros = [];
  faixas.forEach((f, i) => {
    args.push('-i', f.arquivo);
    filtros.push(`[${i + 1}:a]atrim=start=${(f.deslocamento || 0).toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,`
      + `aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${(f.volume ?? 1).toFixed(3)}[f${i}]`);
  });
  let rotulos = faixas.map((_, i) => `[f${i}]`);
  const iv = faixas.findIndex((f) => f.tipo === 'voz');
  const ie = faixas.findIndex((f) => f.tipo === 'efeitos');
  if (iv >= 0 && ie >= 0) {
    filtros.push(`[f${iv}]asplit=2[voz][vozchave]`);
    filtros.push(`[f${ie}][vozchave]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350:makeup=1[efduck]`);
    rotulos = rotulos.map((r, i) => (i === iv ? '[voz]' : i === ie ? '[efduck]' : r));
  }
  filtros.push(`${rotulos.join('')}amix=inputs=${faixas.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,apad[a]`);
  args.push('-filter_complex', filtros.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart', saida);
  await rodar(FFMPEG, args);
}

// ------------------------------------------------------------------ síntese em código (Web Audio offline)
export async function renderizarSomDeCodigo({ script, duracao, saida }) {
  let navegador;
  for (const channel of ['chrome', 'msedge']) {
    try { navegador = await chromium.launch({ channel, headless: true }); break; } catch {}
  }
  if (!navegador) throw new Error('Não encontrei Chrome nem Edge instalados.');
  try {
    const pagina = await navegador.newPage();
    const erros = [];
    pagina.on('pageerror', (e) => erros.push(e.message));
    await pagina.setContent('<!doctype html><html><body></body></html>');
    await pagina.addScriptTag({ content: script }).catch((e) => { throw new Error('Erro no código de som: ' + e.message); });
    const dataUrl = await pagina.evaluate(async (dur) => {
      if (typeof window.sonorizar !== 'function') throw new Error('window.sonorizar não foi definido');
      const sr = 48000;
      const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
      await window.sonorizar(ctx, dur);
      const buf = await ctx.startRendering();
      const n = buf.length;
      const dados = new DataView(new ArrayBuffer(44 + n * 4));
      const txt = (o, s) => { for (let i = 0; i < s.length; i++) dados.setUint8(o + i, s.charCodeAt(i)); };
      txt(0, 'RIFF'); dados.setUint32(4, 36 + n * 4, true); txt(8, 'WAVE'); txt(12, 'fmt ');
      dados.setUint32(16, 16, true); dados.setUint16(20, 1, true); dados.setUint16(22, 2, true);
      dados.setUint32(24, sr, true); dados.setUint32(28, sr * 4, true); dados.setUint16(32, 4, true); dados.setUint16(34, 16, true);
      txt(36, 'data'); dados.setUint32(40, n * 4, true);
      const e = buf.getChannelData(0);
      const d = buf.numberOfChannels > 1 ? buf.getChannelData(1) : e;
      for (let i = 0, o = 44; i < n; i++, o += 4) {
        dados.setInt16(o, Math.max(-1, Math.min(1, e[i])) * 0x7fff, true);
        dados.setInt16(o + 2, Math.max(-1, Math.min(1, d[i])) * 0x7fff, true);
      }
      return await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(new Blob([dados.buffer])); });
    }, duracao);
    await fs.writeFile(saida, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    if (erros.length) console.warn('avisos do código de som:', erros.slice(0, 3));
  } finally {
    await navegador.close().catch(() => {});
  }
}
