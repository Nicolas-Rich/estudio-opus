// Regras que dão um som a cada evento detectado na animação (entra/sai/move), como no motion design:
// tons que sobem a escala em sequência, "tum" sob itens grandes, swish nas saídas, deslizes nos
// movimentos e tiques na digitação — com densidade máxima e respeito aos momentos grandes e silêncios.

export const MOMENTOS_GRANDES = ['impacto', 'boom', 'hit', 'braam', 'stinger', 'reverse', 'riser'];
const DENSIDADE = { sutil: 2, equilibrado: 3.5, intenso: 5 };
const GRANDE = 0.02;     // fração da tela a partir da qual o item é "grande"
const FUSAO = 0.06;      // eventos a menos de 60 ms viram um
const RECOMECO = 0.6;    // escadinha volta ao grau 0 depois de 0,6 s sem entradas

/** Instantes (s) dos momentos grandes do plano de som. */
export function momentosDoPlano(lista = []) {
  return lista.filter((e) => MOMENTOS_GRANDES.includes(e.categoria)).map((e) => e.inicio);
}

const volumeDaArea = (area) => 0.22 + 0.23 * Math.min(1, Math.max(0, area) / 0.1);
const panDe = (x) => Math.max(-0.6, Math.min(0.6, x * 2 - 1));

/** Funde eventos a menos de 60 ms (fica o maior) e limita a densidade por segundo (ficam os maiores). */
function filtrar(eventos, porSegundo) {
  const fundidos = [];
  for (const e of [...eventos].sort((a, b) => a.t - b.t)) {
    const ult = fundidos[fundidos.length - 1];
    if (ult && e.t - ult.t < FUSAO) { if (e.area > ult.area) fundidos[fundidos.length - 1] = e; continue; }
    fundidos.push(e);
  }
  const fim = fundidos.length ? Math.floor(fundidos[fundidos.length - 1].t) : -1;
  const ficam = [];
  for (let s = 0; s <= fim; s++) {
    const cota = Math.floor(porSegundo * (s + 1) + 1e-9) - Math.floor(porSegundo * s + 1e-9);
    const doSegundo = fundidos.filter((e) => e.t >= s && e.t < s + 1);
    ficam.push(...[...doSegundo].sort((a, b) => b.area - a.area).slice(0, cota));
  }
  return ficam.sort((a, b) => a.t - b.t);
}

/**
 * eventos: saída de detectarEventos. Devolve [{ t, som: 'tom'|'tum'|'tique'|'saida'|'deslize', grau, ate, volume, pan }].
 * texturas: quais sons da ElevenLabs existem (os tons são sintetizados e sempre existem).
 */
export function mapearItens(eventos, { texturas = new Set(), notasPorOitava = 5, intensidade = 'equilibrado', momentos = [], silencios = [], duracao = Infinity }) {
  const uteis = eventos.filter((e) => e.tipo !== 'corte' && e.t >= 0 && e.t < duracao);
  const filtrados = filtrar(uteis, DENSIDADE[intensidade] || DENSIDADE.equilibrado);
  const out = [];
  let grau = 0, ultimaEntrada = -Infinity;
  for (const e of filtrados) {
    const pan = panDe(e.x);
    const vol = volumeDaArea(e.area);
    if (e.tipo === 'entra') {
      if (e.digitacao) {
        // digitação não sobe a escada: um tique por letra (ou um tom curto no grau atual sem texturas)
        out.push(texturas.has('tique') ? { t: e.t, som: 'tique', volume: vol, pan } : { t: e.t, som: 'tom', grau, volume: vol, pan });
        ultimaEntrada = e.t;
        continue;
      }
      grau = e.t - ultimaEntrada > RECOMECO ? 0 : grau + 1;
      ultimaEntrada = e.t;
      if (e.area >= GRANDE) {
        out.push({ t: e.t, som: 'tom', grau: grau - notasPorOitava, volume: vol, pan });
        if (texturas.has('tum')) out.push({ t: e.t, som: 'tum', volume: vol, pan });
      } else out.push({ t: e.t, som: 'tom', grau, volume: vol, pan });
    } else if (e.tipo === 'sai') {
      if (texturas.has('saida')) out.push({ t: e.t, som: 'saida', volume: 0.7 * vol, pan });
      out.push({ t: e.t, som: 'tom', grau: grau - 1, volume: 0.7 * vol, pan });
    } else if (e.tipo === 'move') {
      out.push({ t: e.t, som: 'deslize', grau, ate: grau + 2 * (e.dir || 1), volume: 0.8 * vol, pan });
    }
  }
  // perto dos momentos grandes, abaixa; dentro dos silêncios do plano, some
  return out
    .filter((i) => !silencios.some((s) => i.t >= s.inicio && i.t <= s.fim))
    .map((i) => (momentos.some((m) => i.t >= m - 0.15 && i.t <= m + 0.4) ? { ...i, volume: i.volume * 0.4 } : i));
}
