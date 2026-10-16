// Movimento da imagem de um clipe (zoom, canto, meia tela): expressões do ffmpeg por quadros-chave. Puro.

const n = (x) => String(Math.round(x * 10000) / 10000);

/**
 * Expressão linear por partes em t a partir de [{ t, v }]. Antes do primeiro quadro vale o primeiro valor;
 * depois do último, o último. É uma SOMA de trechos (gte·lt·valor), não if aninhado: o avaliador do
 * ffmpeg recusa aninhamento acima de ~100 níveis, e uma soma não tem esse limite.
 */
export function exprPorPartes(quadros) {
  const q = [...quadros].sort((a, b) => a.t - b.t);
  if (q.length === 1) return n(q[0].v);
  const termos = [`lt(t,${n(q[0].t)})*(${n(q[0].v)})`];
  for (let i = 0; i < q.length - 1; i++) {
    const a = q[i];
    const b = q[i + 1];
    if (!(b.t > a.t)) continue;
    const valor = a.v === b.v ? n(a.v) : `${n(a.v)}+(${n(b.v - a.v)})*(t-${n(a.t)})/${n(b.t - a.t)}`;
    termos.push(`gte(t,${n(a.t)})*lt(t,${n(b.t)})*(${valor})`);
  }
  termos.push(`gte(t,${n(q.at(-1).t)})*(${n(q.at(-1).v)})`);
  return termos.join('+');
}

/** Quadros-chave guardados em tempo de mídia → tempo de saída do clipe (começa em 0, com a velocidade aplicada). */
export function movimentoNoClipe(movimento, inicio, vel = 1) {
  return movimento.map((k) => ({ ...k, t: (k.t - (+inicio || 0)) / (vel || 1) }));
}

/**
 * Filtros que colocam a imagem do clipe encolhida/deslocada sobre um fundo (desfoque do próprio clipe ou cor).
 * movimento: [{ t, escala, x, y }] com x/y = centro da imagem em % da tela.
 */
export function filtroMovimento({ entrada, saida, movimento, W, H, fundo = 'desfoque', cor = '#000000', fps = 30 }) {
  const id = saida.slice(1, -1);
  const e = exprPorPartes(movimento.map((m) => ({ t: m.t, v: m.escala })));
  const x = exprPorPartes(movimento.map((m) => ({ t: m.t, v: m.x })));
  const y = exprPorPartes(movimento.map((m) => ({ t: m.t, v: m.y })));
  const linhas = [];
  let frente = entrada;
  if (fundo === 'cor') {
    const hex = /^#[0-9a-f]{6}$/i.test(cor) ? cor.replace('#', '0x') : '0x000000';
    linhas.push(`color=c=${hex}:s=${W}x${H}:r=${fps}[${id}_b]`);
  } else {
    linhas.push(`${entrada}split=2[${id}_bg][${id}_fg]`, `[${id}_bg]boxblur=20:2[${id}_b]`);
    frente = `[${id}_fg]`;
  }
  linhas.push(`${frente}scale=w='${W}*(${e})':h='${H}*(${e})':eval=frame[${id}_s]`);
  linhas.push(`[${id}_b][${id}_s]overlay=x='${W}*(${x})/100-w/2':y='${H}*(${y})/100-h/2':shortest=1:eval=frame${saida}`);
  return linhas;
}
