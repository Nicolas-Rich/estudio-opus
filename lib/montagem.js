// Exportação da edição (editor estilo CapCut): clipes com velocidade, filtros, zoom,
// transições (xfade), texto por clipe, faixa de textos + legendas (ASS), trilha e áudios extras.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FFMPEG } from './ffmpeg.js';
import { gerarAss } from './legendas.js';
import { filtroMovimento, movimentoNoClipe } from './movimento.js';
import { filtrosSobreposicoes } from './sobreposicoes.js';

export const TRANSICOES = ['fade', 'fadeblack', 'fadewhite', 'dissolve', 'slideleft', 'slideright', 'slideup', 'slidedown',
  'wipeleft', 'wiperight', 'circleopen', 'circleclose', 'zoomin', 'smoothleft', 'smoothup', 'radial', 'pixelize', 'hblur', 'coverleft', 'revealright'];

const FILTROS = {
  vivido: 'eq=saturation=1.35:contrast=1.08',
  pb: 'hue=s=0,eq=contrast=1.12',
  quente: 'colorbalance=rs=.08:gs=.02:bs=-.08:rm=.05:bm=-.05',
  frio: 'colorbalance=rs=-.07:bs=.09:rm=-.04:bm=.06',
  vintage: 'curves=preset=vintage',
  contraste: 'eq=contrast=1.25:saturation=1.1',
  desbotado: 'eq=contrast=.85:saturation=.75:brightness=.03',
  cinema: 'curves=preset=strong_contrast,colorbalance=rs=-.04:bs=.06:rh=.06:bh=-.04',
  roxo: 'eq=contrast=1.1:saturation=0.88:gamma=0.94,colorbalance=rs=.03:bs=.08:rm=-.02:bm=.05:rh=.02:bh=.03',
};

const fixo = (c) => c.tipo === 'imagem' || c.tipo === 'cartela';
const vel = (c) => Math.min(4, Math.max(0.25, +c.velocidade || 1));
export const durClipe = (c) => (fixo(c) ? Math.max(0.2, +c.duracaoImagem || 3) : Math.max(0.1, ((+c.fim || 0) - (+c.inicio || 0)) / vel(c)));

/** Posição de cada clipe na timeline (as transições sobrepõem o fim de um clipe com o começo do próximo). */
export function layout(clipes) {
  const out = [];
  let t = 0;
  clipes.forEach((c, i) => {
    const dur = durClipe(c);
    const prox = clipes[i + 1];
    let x = 0;
    if (prox && c.transicao?.tipo && c.transicao.tipo !== 'nenhuma') {
      x = Math.min(+c.transicao.dur || 0.5, dur / 2, durClipe(prox) / 2);
    }
    out.push({ inicio: t, dur, x });
    t += dur - x;
  });
  const ult = out.at(-1);
  return { itens: out, total: ult ? ult.inicio + ult.dur : 0 };
}

function atempo(v) {
  const partes = [];
  let r = v;
  while (r > 2) { partes.push(2); r /= 2; }
  while (r < 0.5) { partes.push(0.5); r /= 0.5; }
  partes.push(r);
  return partes.map((x) => `atempo=${x.toFixed(4)}`).join(',');
}

const caminhoFiltro = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

function rodar(args, aoProgresso, total) {
  return new Promise((ok, falha) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => {
      const s = String(d);
      err += s;
      if (err.length > 200_000) err = err.slice(-80_000);
      const m = /time=(\d+):(\d+):([\d.]+)/.exec(s);
      if (m && total > 0) aoProgresso?.(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / total));
    });
    p.on('error', falha);
    p.on('close', (code) => (code === 0 ? ok() : falha(new Error(err.split('\n').filter(Boolean).slice(-10).join('\n')))));
  });
}

/**
 * tl = { largura, altura, fps, encaixe, clipes[], musica, audios[], textos[], legendas }
 *   clipe: { tipo, arquivo, temAudio, inicio, fim, duracaoImagem, velocidade, volume, mudo, fadeIn, fadeOut,
 *            filtro: { preset, brilho, contraste, saturacao }, zoom, transicao: { tipo, dur }, cor (cartela),
 *            texto + estilo (texto do próprio clipe, legado) }
 * opcoes.soAudio: gera só o áudio (wav) — usado para transcrever e criar legendas.
 * opcoes.semMusica: ignora a trilha (para a transcrição ouvir só as falas).
 */
export async function exportarEdicao(tl, saida, pastaTemp, aoProgresso, opcoes = {}) {
  const W = tl.largura;
  const H = tl.altura;
  const fps = tl.fps || 30;
  const soAudio = !!opcoes.soAudio;
  const { itens, total } = layout(tl.clipes);
  const entradas = [];
  const filtros = [];
  let nIn = 0;
  const entrada = (...args) => { entradas.push(...args); return nIn++; };

  tl.clipes.forEach((c, i) => {
    const { dur } = itens[i];
    const fonte = fixo(c) ? dur : (+c.fim - +c.inicio);
    let idx = null;
    if (c.tipo === 'cartela') {
      if (!soAudio) {
        const cor = /^#[0-9a-f]{6}$/i.test(c.cor || '') ? c.cor.replace('#', '0x') : '0x000000';
        idx = entrada('-f', 'lavfi', '-t', dur.toFixed(3), '-i', `color=c=${cor}:s=${W}x${H}:r=${fps}`);
      }
    } else if (c.tipo === 'imagem') {
      if (!soAudio) idx = entrada('-loop', '1', '-framerate', String(fps), '-t', dur.toFixed(3), '-i', c.arquivo);
    } else {
      idx = entrada('-ss', (+c.inicio || 0).toFixed(3), '-t', fonte.toFixed(3), '-i', c.arquivo);
    }

    // ---------- vídeo do clipe
    if (!soAudio) {
      const cobrir = (c.encaixe || tl.encaixe) !== 'conter';
      let v = `[${idx}:v]` + (cobrir
        ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
        : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`);
      v += ',setsar=1';
      if (!fixo(c) && vel(c) !== 1) v += `,setpts=(PTS-STARTPTS)/${vel(c)}`;
      v += `,fps=${fps}`;
      // movimento da imagem (Edição IA): encolhe/desloca sobre fundo desfocado ou de cor
      if (c.movimento?.length) {
        filtros.push(`${v},setpts=PTS-STARTPTS[pre${i}]`);
        filtros.push(...filtroMovimento({ entrada: `[pre${i}]`, saida: `[mov${i}]`, movimento: movimentoNoClipe(c.movimento, c.inicio, vel(c)), W, H, fundo: tl.fundoMovimento, cor: tl.corFundo, fps }));
        v = `[mov${i}]null`;
      }
      if (fixo(c) && c.zoom && c.zoom !== 'nenhum') {
        const n = Math.max(1, Math.round(dur * fps));
        const z = c.zoom === 'afastar' ? `1.18-0.18*on/${n}` : `1+0.18*on/${n}`;
        v += `,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${fps}`;
      }
      const f = c.filtro || {};
      if (FILTROS[f.preset]) v += ',' + FILTROS[f.preset];
      if (+f.brilho || (f.contraste && +f.contraste !== 1) || (f.saturacao != null && +f.saturacao !== 1)) {
        v += `,eq=brightness=${(+f.brilho || 0).toFixed(3)}:contrast=${(+f.contraste || 1).toFixed(3)}:saturation=${(f.saturacao ?? 1).toFixed(3)}`;
      }
      v += `,format=yuv420p,trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS`;
      if (+c.fadeIn > 0) v += `,fade=t=in:st=0:d=${(+c.fadeIn).toFixed(2)}`;
      if (+c.fadeOut > 0) v += `,fade=t=out:st=${Math.max(0, dur - c.fadeOut).toFixed(2)}:d=${(+c.fadeOut).toFixed(2)}`;
      v += ',settb=AVTB';
      filtros.push(`${v}[v${i}]`);
    }

    // ---------- áudio do clipe
    const vol = c.mudo ? 0 : (c.volume ?? 1);
    if (!fixo(c) && c.temAudio && vol > 0) {
      let a = `[${idx}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`;
      if (vel(c) !== 1) a += ',' + atempo(vel(c));
      a += `,volume=${vol},apad=whole_dur=${dur.toFixed(3)},atrim=duration=${dur.toFixed(3)}`;
      if (+c.fadeIn > 0) a += `,afade=t=in:st=0:d=${(+c.fadeIn).toFixed(2)}`;
      if (+c.fadeOut > 0) a += `,afade=t=out:st=${Math.max(0, dur - c.fadeOut).toFixed(2)}:d=${(+c.fadeOut).toFixed(2)}`;
      filtros.push(`${a}[a${i}]`);
    } else {
      filtros.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${dur.toFixed(3)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    }
  });

  // ---------- encadeia os clipes (corte seco = concat; transição = xfade/acrossfade)
  let rv = '[v0]';
  let ra = '[a0]';
  let acc = itens[0]?.dur || 0;
  for (let i = 1; i < tl.clipes.length; i++) {
    const x = itens[i - 1].x;
    const tipo = TRANSICOES.includes(tl.clipes[i - 1].transicao?.tipo) ? tl.clipes[i - 1].transicao.tipo : 'fade';
    if (!soAudio) {
      filtros.push(x > 0
        ? `${rv}[v${i}]xfade=transition=${tipo}:duration=${x.toFixed(3)}:offset=${(acc - x).toFixed(3)}[cv${i}]`
        : `${rv}[v${i}]concat=n=2:v=1:a=0[cv${i}]`);
      rv = `[cv${i}]`;
    }
    filtros.push(x > 0 ? `${ra}[a${i}]acrossfade=d=${x.toFixed(3)}[ca${i}]` : `${ra}[a${i}]concat=n=2:v=0:a=1[ca${i}]`);
    ra = `[ca${i}]`;
    acc += itens[i].dur - x;
  }

  // ---------- camadas de áudio: trilha + áudios extras
  const camadas = [ra];
  if (tl.musica?.arquivo && !opcoes.semMusica) {
    const m = entrada('-stream_loop', '-1', '-i', tl.musica.arquivo);
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
    if (+x.cortarInicio > 0) entradas.push('-ss', (+x.cortarInicio).toFixed(3));
    const e = entrada('-i', x.arquivo);
    const cabe = total - (+x.inicio || 0);
    const dur = Math.min(cabe, +x.duracao > 0 ? +x.duracao : cabe);
    const ms = Math.round((+x.inicio || 0) * 1000);
    let f = `[${e}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${dur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${x.volume ?? 1}`;
    if (+x.fadeIn > 0) f += `,afade=t=in:st=0:d=${(+x.fadeIn).toFixed(2)}`;
    if (+x.fadeOut > 0) f += `,afade=t=out:st=${Math.max(0, dur - x.fadeOut).toFixed(2)}:d=${(+x.fadeOut).toFixed(2)}`;
    filtros.push(`${f},adelay=${ms}|${ms}[ex${k}]`);
    camadas.push(`[ex${k}]`);
  }
  let mapaAudio = ra;
  if (camadas.length > 1) {
    filtros.push(`${camadas.join('')}amix=inputs=${camadas.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`);
    mapaAudio = '[aout]';
  }

  // ---------- elementos sobrepostos (Edição IA), por baixo dos textos e legendas
  if (!soAudio && tl.sobreposicoes?.length) {
    const s = filtrosSobreposicoes({ sobreposicoes: tl.sobreposicoes, rv, indiceEntrada: (arq) => entrada('-i', arq), total });
    filtros.push(...s.filtros);
    rv = s.rv;
  }

  // ---------- textos + legendas por cima de tudo
  let mapaVideo = rv;
  if (!soAudio) {
    const temTextos = (tl.textos || []).some((t) => t.texto?.trim());
    const temLegendas = tl.legendas?.ativo !== false && tl.legendas?.itens?.length;
    const textoClipe = tl.clipes.some((c) => c.texto?.trim());
    if (temTextos || temLegendas || textoClipe) {
      // texto próprio de cada clipe vira um item da faixa de textos no tempo do clipe
      const textosClipes = tl.clipes.map((c, i) => (c.texto?.trim() ? {
        texto: c.texto, inicio: itens[i].inicio, fim: itens[i].inicio + itens[i].dur,
        pos: c.textoPos || 'base', tam: c.textoTam || 'm', cor: c.textoCor, estilo: c.textoFundo ? 'caixa' : 'contorno',
        fonte: c.fonte, anim: c.textoAnimado ? 'fade' : 'nenhuma',
      } : null)).filter(Boolean);
      const arqAss = path.join(pastaTemp, 'textos.ass');
      await fs.writeFile(arqAss, gerarAss({ largura: W, altura: H, textos: [...(tl.textos || []), ...textosClipes], legendas: tl.legendas }), 'utf8');
      filtros.push(`${rv}ass='${caminhoFiltro(arqAss)}':fontsdir='${caminhoFiltro('C:/Windows/Fonts')}'[vfinal]`);
      mapaVideo = '[vfinal]';
    }
  }

  const script = path.join(pastaTemp, 'filtros.txt');
  await fs.writeFile(script, filtros.join(';\n'), 'utf8');
  const args = ['-y', '-hide_banner', ...entradas, '-filter_complex_script', script];
  if (soAudio) args.push('-map', mapaAudio, '-ac', '1', '-ar', '16000', '-t', total.toFixed(3), saida);
  else {
    args.push('-map', mapaVideo, '-map', mapaAudio,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-r', String(fps), '-movflags', '+faststart', '-t', total.toFixed(3), saida);
  }
  await rodar(args, aoProgresso, total);
  return total;
}
