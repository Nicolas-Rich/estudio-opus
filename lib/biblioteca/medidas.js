// Medidas de sinal de cada som da biblioteca (puras, sem ffmpeg): ataque, brilho, aspereza, pico/rms,
// fatias (arquivos com vários golpes viram golpes individuais) e mini-onda para a lista.

const maximo = (a) => { let m = 0; for (const v of a) if (v > m) m = v; return m; };
const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);

/** Biquad RBJ aplicado em JS; devolve a energia do sinal filtrado. */
function energiaFiltrada(x, sr, tipo, f, Q) {
  const w0 = (2 * Math.PI * f) / sr;
  const cos = Math.cos(w0), alfa = Math.sin(w0) / (2 * Q);
  const [b0, b1, b2] = tipo === 'passa-alta' ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2] : [alfa, 0, -alfa];
  const a0 = 1 + alfa, a1 = -2 * cos, a2 = 1 - alfa;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, e = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    e += y * y;
  }
  return e;
}

/** Máximo absoluto em janelas de `ms` milissegundos. */
function envelope(x, sr, ms) {
  const h = Math.max(1, Math.round((sr * ms) / 1000));
  const env = new Float32Array(Math.ceil(x.length / h));
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); const k = (i / h) | 0; if (v > env[k]) env[k] = v; }
  return env;
}

/** { ataqueMs, brilho, aspereza, pico, rms } — brilho = energia > 4 kHz; aspereza = energia em 2–5 kHz. */
export function medirSom(pcm, sr) {
  let total = 0, max = 0;
  for (const v of pcm) { total += v * v; if (Math.abs(v) > max) max = Math.abs(v); }
  const env = envelope(pcm, sr, 1);
  const pk = maximo(env);
  const i10 = env.findIndex((v) => v >= 0.1 * pk);
  const i90 = env.findIndex((v) => v >= 0.9 * pk);
  return {
    ataqueMs: pk > 0 ? Math.max(0, i90 - i10) : 0,
    brilho: total ? energiaFiltrada(pcm, sr, 'passa-alta', 4000, Math.SQRT1_2) / total : 0,
    aspereza: total ? energiaFiltrada(pcm, sr, 'passa-faixa', 3162, 1.05) / total : 0,
    pico: db(max),
    rms: db(Math.sqrt(total / Math.max(1, pcm.length))),
  };
}

/**
 * Golpes separados por silêncio (< −45 dB do pico por ≥ 150 ms), com 5 ms antes e 30 ms depois.
 * Só para arquivos de até 60 s que deem 2 golpes ou mais; senão [].
 */
export function fatiar(pcm, sr) {
  if (pcm.length / sr > 60) return [];
  const JANELA = 0.005;
  const env = envelope(pcm, sr, JANELA * 1000);
  const pk = maximo(env);
  if (!pk) return [];
  const limiar = pk * 10 ** (-45 / 20);
  const gap = Math.round(0.15 / JANELA);
  const dur = pcm.length / sr;
  const fatias = [];
  let ini = -1, ultimoAtivo = -1;
  const fechar = () => {
    const inicio = Math.max(0, ini * JANELA - 0.005);
    const fim = Math.min(dur, (ultimoAtivo + 1) * JANELA + 0.03);
    if (fim - inicio >= 0.04 - 1e-9) fatias.push({ inicio, fim });
  };
  for (let k = 0; k < env.length; k++) {
    if (env[k] > limiar) {
      if (ini < 0) ini = k;
      else if (k - ultimoAtivo > gap) { fechar(); ini = k; }
      ultimoAtivo = k;
    }
  }
  if (ini >= 0) fechar();
  // estalos e caudas fracos (pico do trecho < −30 dB do pico do arquivo) não são golpes; no máximo 64 por arquivo
  const forte = pk * 10 ** (-30 / 20);
  const golpes = fatias.filter((f) => {
    let m = 0;
    for (let k = Math.floor((f.inicio + 0.005) / JANELA); k < Math.min(env.length, Math.ceil((f.fim - 0.03) / JANELA)); k++) if (env[k] > m) m = env[k];
    return m >= forte;
  }).slice(0, 64);
  return golpes.length >= 2 ? golpes : [];
}

/** Pico por bloco (0–1), normalizado pelo maior. */
export function miniOnda(pcm, n = 48) {
  const out = new Array(n).fill(0);
  const tam = Math.max(1, Math.ceil(pcm.length / n));
  for (let i = 0; i < pcm.length; i++) { const k = Math.min(n - 1, (i / tam) | 0); const v = Math.abs(pcm[i]); if (v > out[k]) out[k] = v; }
  const max = Math.max(...out);
  return max ? out.map((v) => Math.round((v / max) * 1000) / 1000) : out;
}

/** 1 = macio, 0 = áspero. */
export const macioDe = (aspereza) => 1 - Math.min(1, Math.max(0, (aspereza - 0.05) / 0.25));
