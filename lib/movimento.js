// Movimento da imagem de um clipe (zoom, canto, meia tela): expressões do ffmpeg por quadros-chave. Puro.

const n = (x) => String(Math.round(x * 10000) / 10000);

/** Expressão linear por partes em t a partir de [{ t, v }] (ordenados). Depois do último quadro, fica no último valor. */
export function exprPorPartes(quadros) {
  const q = [...quadros].sort((a, b) => a.t - b.t);
  if (q.length === 1) return n(q[0].v);
  let expr = n(q.at(-1).v);
  for (let i = q.length - 2; i >= 0; i--) {
    const a = q[i];
    const b = q[i + 1];
    const trecho = a.v === b.v ? n(a.v) : `${n(a.v)}+(${n(b.v - a.v)})*(t-${n(a.t)})/${n(b.t - a.t)}`;
    expr = `if(lt(t,${n(b.t)}),${trecho},${expr})`;
  }
  return expr;
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
