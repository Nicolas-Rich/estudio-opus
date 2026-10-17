// Tons e deslizes afinados, sintetizados no PC (grátis e na afinação exata): o "plim" de cada item
// que entra, numa escala musical, como no motion design de referência. ffmpeg aevalsrc → WAV 48 kHz estéreo.
import { spawn } from 'node:child_process';
import { FFMPEG } from './ffmpeg.js';

const NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const MODOS = {
  pentatonica_maior: [0, 2, 4, 7, 9],
  pentatonica_menor: [0, 3, 5, 7, 10],
  maior: [0, 2, 4, 5, 7, 9, 11],
  dorico: [0, 2, 3, 5, 7, 9, 10],
};

/** Frequência (Hz) do grau da escala; o grau 0 é a tônica na oitava dada, graus além da escala mudam de oitava. */
export function frequenciaDaNota({ tonica, modo, oitava }, grau) {
  const escala = MODOS[modo] || MODOS.pentatonica_maior;
  const n = escala.length;
  const oit = Math.floor(grau / n);
  const midi = 12 * (oitava + 1) + Math.max(0, NOTAS.indexOf(tonica)) + escala[grau - oit * n] + 12 * oit;
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Expressão do aevalsrc: ataque de 3 ms e decaimento exponencial; fase = 2π∫f(t)dt. */
function expressao(fase, timbre, duracao) {
  const tau = (duracao / 5).toFixed(4);
  const env = `if(lt(t,0.003),t/0.003,exp(-(t-0.003)/${tau}))`;
  const corpo = timbre === 'soft_fm' ? `sin(${fase}+1.5*${env}*sin(2*(${fase})))`
    : timbre === 'triangle' ? `asin(sin(${fase}))*2/PI`
      : `sin(${fase})+0.126*sin(2*(${fase}))`;
  return `${env}*(${corpo})`;
}

function gerar(expr, timbre, duracao, saida) {
  // vírgulas da expressão são escapadas: no grafo do lavfi a vírgula separa filtros
  const fonte = `aevalsrc=${expr.replace(/,/g, '\\,')}:s=48000:d=${duracao.toFixed(3)}`;
  const af = `${timbre === 'triangle' ? 'lowpass=f=6000,' : ''}pan=stereo|c0=c0|c1=c0,aformat=channel_layouts=stereo,volume=-6dB`;
  return new Promise((ok, falha) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', fonte, '-af', af, '-ar', '48000', saida],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok(saida) : falha(new Error('ffmpeg (tom): ' + err.slice(-400)))));
  });
}

/** Tom afinado ("plim"). timbre: sine | soft_fm | triangle. */
export function sintetizarTom({ freq, timbre = 'sine', duracao = 0.25, saida }) {
  return gerar(expressao(`2*PI*${freq.toFixed(3)}*t`, timbre, duracao), timbre, duracao, saida);
}

/** Deslize de tom de uma frequência a outra (acompanha um movimento). */
export function sintetizarDeslize({ de, ate, timbre = 'sine', duracao = 0.25, saida }) {
  const fase = `2*PI*(${de.toFixed(3)}*t+${(ate - de).toFixed(3)}*t*t/${(2 * duracao).toFixed(4)})`;
  return gerar(expressao(fase, timbre, duracao), timbre, duracao, saida);
}
