// Sons táteis "quase ASMR": cliques, teclas, digitação, caneta, papel, ticks e botões.
// Em qualquer estilo eles são pedidos, tratados e mixados para soar de perto, macios e satisfatórios
// (sem a aspereza dos 3–4 kHz, sem sala grande, sem "metralhadora" quando o mesmo som se repete).

const PALAVRAS_TATEIS = /\b(click|clicks|clicking|tap|taps|tapping|key|keys|keystroke|keystrokes|keyboard|typing|typewriter|pen|pencil|marker|paper|scribble|tick|ticks|button|switch|tactile|press)\b/i;

/** Um som é tátil pela categoria (ui, foley) ou pela descrição; a cama de ambiência nunca é. */
export function ehTatil(categoria, descricao = '') {
  if (categoria === 'ambiente') return false;
  return categoria === 'ui' || categoria === 'foley' || PALAVRAS_TATEIS.test(descricao);
}

const ASMR = 'ASMR close-mic recording, intimate and soft, crisp tactile detail, satisfying gentle transient, '
  + 'warm and smooth, no harshness, dry with no reverb, clean silent background';
const CINEMA = 'cinematic sound design, high fidelity, studio quality';
const ISOLADO = 'isolated sound effect, no music, no melody, no voice, no speech';

/** Texto e prompt_influence do pedido de efeito à ElevenLabs. */
export function textoDoPedidoSfx({ descricao, categoria, dica = '', loop = false }) {
  const tatil = ehTatil(categoria, descricao);
  const texto = [descricao.replace(/\.\s*$/, ''), tatil ? '' : dica, tatil ? ASMR : CINEMA, ISOLADO]
    .filter(Boolean).join('. ').slice(0, 450);
  return { texto, influencia: loop ? 0.4 : tatil ? 0.7 : 0.55 };
}

/**
 * Tratamento do som tátil: corpo leve em 250 Hz, corte suave na faixa áspera (~3,2 kHz), de-esser,
 * "ar" sedoso acima de 10 kHz e microfades nas pontas (nada de estalo). Sem reverb.
 */
export function cadeiaTatil() {
  return 'highpass=f=90,equalizer=f=250:t=q:w=1:g=1.5,equalizer=f=3200:t=q:w=1.2:g=-3,'
    + 'deesser=i=0.3,highshelf=f=10000:g=2,'
    + 'afade=t=in:d=0.002,areverse,afade=t=in:d=0.004,areverse';
}

const fracao = (x) => x - Math.floor(x);
/** Variação da n-ésima repetição de um som (0 = original): tom ±3% e volume ±1,5 dB, sempre igual para o mesmo n. */
export function variacao(n) {
  if (!n) return { tom: 1, ganhoDb: 0 };
  const a = fracao(Math.sin(n * 12.9898) * 43758.5453);
  const b = fracao(Math.sin(n * 78.233) * 43758.5453);
  return { tom: Math.round((1 + (a * 2 - 1) * 0.03) * 10000) / 10000, ganhoDb: Math.round((b * 2 - 1) * 1.5 * 100) / 100 };
}
