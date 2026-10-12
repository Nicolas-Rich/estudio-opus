// ffmpeg/ffprobe embutidos (ffmpeg-static / ffprobe-static) + montagem da timeline.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

export const FFMPEG = ffmpegStatic;
export const FFPROBE = ffprobeStatic.path;

const EXT_IMAGEM = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const EXT_AUDIO = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus']);

export function tipoDeArquivo(nome) {
  const ext = path.extname(nome).toLowerCase();
  if (EXT_IMAGEM.has(ext)) return 'imagem';
  if (EXT_AUDIO.has(ext)) return 'audio';
  return 'video';
}

function rodar(bin, args, { aoProgresso } = {}) {
  return new Promise((ok, falha) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => {
      err += d;
      if (err.length > 200_000) err = err.slice(-100_000);
      aoProgresso?.(String(d));
    });
    p.on('error', falha);
    p.on('close', (code) => (code === 0 ? ok(out) : falha(new Error(err.split('\n').slice(-12).join('\n')))));
  });
}

export async function sondar(arquivo) {
  const tipo = tipoDeArquivo(arquivo);
  try {
    const out = await rodar(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', arquivo]);
    const j = JSON.parse(out);
    const v = j.streams.find((s) => s.codec_type === 'video');
    const a = j.streams.find((s) => s.codec_type === 'audio');
    return {
      tipo,
      duracao: tipo === 'imagem' ? 0 : Number(j.format?.duration) || 0,
      largura: v?.width || 0,
      altura: v?.height || 0,
      temAudio: !!a,
    };
  } catch {
    return { tipo, duracao: 0, largura: 0, altura: 0, temAudio: false };
  }
}

export async function miniatura(arquivo, saida, segundo = 0.5) {
  await rodar(FFMPEG, ['-y', '-ss', String(segundo), '-i', arquivo, '-frames:v', '1', '-vf', 'scale=320:-2', saida]);
}

// caminho dentro de filtergraph do ffmpeg no Windows: C\:/pasta/arquivo
const caminhoFiltro = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

function quebrarLinhas(texto, max) {
  return texto.split('\n').map((paragrafo) => {
    const linhas = [];
    let atual = '';
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      if (atual && (atual + ' ' + palavra).length > max) { linhas.push(atual); atual = palavra; }
      else atual = atual ? atual + ' ' + palavra : palavra;
    }
    if (atual) linhas.push(atual);
    return linhas.join('\n');
  }).join('\n');
}

const FONTES = {
  impacto: 'C:/Windows/Fonts/impact.ttf',
  negrito: 'C:/Windows/Fonts/arialbd.ttf',
  normal: 'C:/Windows/Fonts/arial.ttf',
  serifa: 'C:/Windows/Fonts/georgiab.ttf',
};

/**
 * Exporta a timeline.
 * timeline = {
 *   largura, altura, fps, encaixe: 'cobrir'|'conter',
 *   clipes: [{ arquivo, tipo, inicio, fim, duracaoImagem, volume, fadeIn, fadeOut,
 *              texto, textoPos, textoTam, textoCor, textoFundo, fonte }],
 *   musica: { arquivo, volume, fadeOut } | null
 * }
 */
export async function exportarTimeline(tl, saida, pastaTemp, aoProgresso) {
  const W = tl.largura;
  const H = tl.altura;
  const fps = tl.fps || 30;
  const entradas = [];
  const filtros = [];
  const pares = [];
  let total = 0;

  for (let i = 0; i < tl.clipes.length; i++) {
    const c = tl.clipes[i];
    const fixo = c.tipo === 'imagem' || c.tipo === 'cartela';
    const dur = fixo
      ? Math.max(0.2, +c.duracaoImagem || 3)
      : Math.max(0.1, (+c.fim || 0) - (+c.inicio || 0));
    if (c.tipo === 'cartela') {
      const cor = /^#[0-9a-f]{6}$/i.test(c.cor || '') ? c.cor.replace('#', '0x') : '0x000000';
      entradas.push('-f', 'lavfi', '-t', dur.toFixed(3), '-i', `color=c=${cor}:s=${W}x${H}:r=${fps}`);
    } else if (c.tipo === 'imagem') entradas.push('-loop', '1', '-framerate', String(fps), '-t', dur.toFixed(3), '-i', c.arquivo);
    else entradas.push('-ss', (+c.inicio || 0).toFixed(3), '-t', dur.toFixed(3), '-i', c.arquivo);

    const encaixe = (c.encaixe || tl.encaixe) === 'conter'
      ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`
      : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    let v = `[${i}:v]${encaixe},setsar=1,fps=${fps},format=yuv420p,trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS`;
    if (+c.fadeIn > 0) v += `,fade=t=in:st=0:d=${(+c.fadeIn).toFixed(2)}`;
    if (+c.fadeOut > 0) v += `,fade=t=out:st=${Math.max(0, dur - c.fadeOut).toFixed(2)}:d=${(+c.fadeOut).toFixed(2)}`;

    if (c.texto && c.texto.trim()) {
      const tam = Math.round(H * ({ p: 0.035, m: 0.05, g: 0.07, gg: 0.095 }[c.textoTam || 'm'] || 0.05));
      // drawtext não quebra linha sozinho: quebra por largura estimada (~0.6 × fonte por caractere)
      const porLinha = Math.max(6, Math.floor((W * 0.88) / (tam * 0.6)));
      const arqTexto = path.join(pastaTemp, `texto-${i}.txt`);
      await fs.writeFile(arqTexto, quebrarLinhas(c.texto.trim(), porLinha), 'utf8');
      const margem = Math.round(H * 0.08);
      const y = { topo: `${margem}`, centro: '(h-text_h)/2', base: `h-text_h-${margem}` }[c.textoPos || 'base'] || `h-text_h-${margem}`;
      const fonte = FONTES[c.fonte] || FONTES.negrito;
      const cor = (c.textoCor || '#ffffff').replace('#', '0x');
      let dt = `drawtext=fontfile='${caminhoFiltro(fonte)}':textfile='${caminhoFiltro(arqTexto)}':expansion=none`
        + `:text_align=C:fontsize=${tam}:fontcolor=${cor}:x=(w-text_w)/2:y=${y}:line_spacing=${Math.round(tam * 0.25)}`
        + `:borderw=${Math.max(2, Math.round(tam / 14))}:bordercolor=black@0.85`;
      if (c.textoFundo) dt += `:box=1:boxcolor=black@0.55:boxborderw=${Math.round(tam * 0.4)}`;
      if (c.textoAnimado) dt += `:alpha='min(1,t/0.35)'`;
      v += ',' + dt;
    }
    filtros.push(`${v}[v${i}]`);

    const vol = c.volume ?? 1;
    if (!fixo && c.temAudio && vol > 0) {
      filtros.push(`[${i}:a]atrim=duration=${dur.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${vol},apad=whole_dur=${dur.toFixed(3)}[a${i}]`);
    } else {
      filtros.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${dur.toFixed(3)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    }
    pares.push(`[v${i}][a${i}]`);
    total += dur;
  }

  const n = tl.clipes.length;
  filtros.push(`${pares.join('')}concat=n=${n}:v=1:a=1[vout][acat]`);

  // camadas de áudio por cima do áudio dos clipes: música de fundo + áudios extras posicionados no tempo
  const camadas = ['[acat]'];
  let proxEntrada = n;
  if (tl.musica?.arquivo) {
    const m = proxEntrada++;
    entradas.push('-stream_loop', '-1', '-i', tl.musica.arquivo);
    const fi = Math.min(+tl.musica.fadeIn || 0, total);
    const fo = Math.min(+tl.musica.fadeOut || 0, total);
    let f = `[${m}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${total.toFixed(3)},volume=${tl.musica.volume ?? 0.5}`;
    if (fi > 0) f += `,afade=t=in:st=0:d=${fi.toFixed(2)}`;
    if (fo > 0) f += `,afade=t=out:st=${(total - fo).toFixed(2)}:d=${fo.toFixed(2)}`;
    filtros.push(`${f}[mus]`);
    camadas.push('[mus]');
  }
  for (const [k, x] of (tl.audios || []).entries()) {
    if (!x.arquivo || +x.inicio >= total) continue;
    const e = proxEntrada++;
    if (+x.cortarInicio > 0) entradas.push('-ss', (+x.cortarInicio).toFixed(3));
    entradas.push('-i', x.arquivo);
    const cabe = total - (+x.inicio || 0);
    const dur = Math.min(cabe, +x.duracao > 0 ? +x.duracao : cabe);
    const ms = Math.round((+x.inicio || 0) * 1000);
    let f = `[${e}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${dur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${x.volume ?? 1}`;
    if (+x.fadeIn > 0) f += `,afade=t=in:st=0:d=${(+x.fadeIn).toFixed(2)}`;
    if (+x.fadeOut > 0) f += `,afade=t=out:st=${Math.max(0, dur - x.fadeOut).toFixed(2)}:d=${(+x.fadeOut).toFixed(2)}`;
    filtros.push(`${f},adelay=${ms}|${ms}[ex${k}]`);
    camadas.push(`[ex${k}]`);
  }
  let mapaAudio = '[acat]';
  if (camadas.length > 1) {
    filtros.push(`${camadas.join('')}amix=inputs=${camadas.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`);
    mapaAudio = '[aout]';
  }

  const script = path.join(pastaTemp, 'filtros.txt');
  await fs.writeFile(script, filtros.join(';\n'), 'utf8');

  const args = [
    '-y', '-hide_banner', ...entradas,
    '-filter_complex_script', script,
    '-map', '[vout]', '-map', mapaAudio,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-r', String(fps),
    '-movflags', '+faststart', '-t', total.toFixed(3), saida,
  ];
  await rodar(FFMPEG, args, {
    aoProgresso: (txt) => {
      const m = /time=(\d+):(\d+):([\d.]+)/.exec(txt);
      if (m && total > 0) aoProgresso?.(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / total));
    },
  });
  return total;
}
