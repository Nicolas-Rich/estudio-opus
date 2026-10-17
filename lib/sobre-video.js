// Animação por cima do vídeo da pessoa: compõe a animação renderizada com fundo transparente (.mov PNG)
// sobre o vídeo enviado. Sai sem áudio — a voz original entra depois pelo mixer do projeto.
import { execFile, spawn } from 'node:child_process';
import { FFMPEG, FFPROBE } from './ffmpeg.js';

/** Largura/altura como o vídeo aparece (celular costuma gravar deitado com uma marca de rotação). */
export function dimensoesExibidas(stream = {}) {
  const rot = Math.abs(+(stream.side_data_list || []).find((d) => d.rotation != null)?.rotation || +stream.tags?.rotate || 0) % 180;
  return rot === 90 ? { largura: stream.height, altura: stream.width } : { largura: stream.width, altura: stream.height };
}

/** Dimensões exibidas + duração de um arquivo de vídeo. */
export function sondarVideo(arquivo) {
  return new Promise((ok) => {
    execFile(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', arquivo], { windowsHide: true }, (erro, saida) => {
      if (erro) return ok(null);
      try {
        const j = JSON.parse(saida);
        const v = j.streams.find((s) => s.codec_type === 'video');
        if (!v) return ok(null);
        ok({ ...dimensoesExibidas(v), duracao: +j.format?.duration || 0, temAudio: j.streams.some((s) => s.codec_type === 'audio') });
      } catch { ok(null); }
    });
  });
}

/** Argumentos do ffmpeg: vídeo de fundo cobrindo o quadro (sem esticar) + animação com alfa por cima. */
export function argsComporSobreVideo({ fundo, anim, saida, largura, altura, fps = 30, duracao, inicio = 0 }) {
  const filtro = `[0:v]scale=${largura}:${altura}:force_original_aspect_ratio=increase,crop=${largura}:${altura},setsar=1,fps=${fps}[b];`
    + `[1:v]format=rgba[a];[b][a]overlay=0:0:format=auto,format=yuv420p[v]`;
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...(inicio > 0 ? ['-ss', (+inicio).toFixed(3)] : []), '-i', fundo, '-i', anim,
    '-filter_complex', filtro, '-map', '[v]', '-an',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-t', (+duracao).toFixed(3), saida,
  ];
}

export function comporSobreVideo(o) {
  return new Promise((ok, falha) => {
    const p = spawn(FFMPEG, argsComporSobreVideo(o), { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    o.sinal?.addEventListener('abort', () => p.kill());
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok() : falha(new Error('ffmpeg (composição): ' + err.slice(-600)))));
  });
}
