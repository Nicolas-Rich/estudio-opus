// Edição IA: transforma o plano + os elementos prontos numa edição do Editor (edicao.json). Puro.
import { agruparLegendas } from '../legendas.js';

const W = 1080;
const H = 1920;
const RAMPA = 0.35;
const PASSO_RAMPA = RAMPA / 4;
const MARGEM = 4;
const NORMAL = { escala: 1, x: 50, y: 50 };

const r3 = (x) => Math.round(x * 1000) / 1000;
const ease = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** Converte tempos da linha do tempo base (antes dos cortes) para a editada. */
export function mapaTempo(manter) {
  const trechos = [];
  let acc = 0;
  for (const t of manter) { trechos.push({ ...t, desloc: acc }); acc += t.fim - t.inicio; }
  return {
    total: r3(acc),
    paraEditado(t) {
      const tr = trechos.find((x) => t >= x.inicio && t <= x.fim);
      return tr ? r3(tr.desloc + t - tr.inicio) : null;
    },
  };
}

function alvoDoMovimento(m) {
  const e = +m.escala || 0;
  switch (m.tipo) {
    case 'zoom': return { escala: e || 1.2, x: 50, y: 50 };
    case 'canto': {
      const s = e || 0.38;
      const [v, h] = String(m.canto || 'inferior-esquerdo').split('-');
      return { escala: s, x: h === 'direito' ? 100 - MARGEM - 50 * s : MARGEM + 50 * s, y: v === 'superior' ? MARGEM + 50 * s : 100 - MARGEM - 50 * s };
    }
    case 'meia': return { escala: 0.5, x: 50, y: m.lado === 'superior' ? 25 : 75 };
    case 'lado': return { escala: 1, x: 50 + (m.direcao === 'esquerda' ? -1 : 1) * (+m.deslocamento || 20), y: 50 };
    default: return { ...NORMAL };
  }
}

/** Posição/tamanho da imagem da pessoa no tempo base t: { escala, x, y } (x/y = centro em % da tela). */
export function estadoDaImagem(movimentos, t) {
  let s = { ...NORMAL };
  for (const m of movimentos) {
    if (t < m.inicio || t > m.fim) continue;
    const peso = Math.min(ease((t - m.inicio) / RAMPA), ease((m.fim - t) / RAMPA));
    const alvo = alvoDoMovimento(m);
    s = { escala: s.escala + (alvo.escala - s.escala) * peso, x: s.x + (alvo.x - s.x) * peso, y: s.y + (alvo.y - s.y) * peso };
  }
  return { escala: r3(s.escala), x: r3(s.x), y: r3(s.y) };
}

/**
 * Furo transparente que um elemento de tela cheia precisa ter para a pessoa encolhida continuar visível:
 * [{ t (desde o início do elemento), x, y, w, h }] em pixels, 15 por segundo; null se ela não estiver encolhida.
 */
export function furoDaPessoa(movimentos, el) {
  if (el.camada !== 'tela-cheia') return null;
  const quadros = [];
  const dur = el.fim - el.inicio;
  for (let k = 0; k <= Math.ceil(dur * 15); k++) {
    const t = Math.min(dur, k / 15);
    const s = estadoDaImagem(movimentos, el.inicio + t);
    const w = W * s.escala;
    const h = H * s.escala;
    quadros.push({ t: r3(t), x: Math.round((W * s.x) / 100 - w / 2), y: Math.round((H * s.y) / 100 - h / 2), w: Math.round(w), h: Math.round(h), escala: s.escala });
  }
  if (!quadros.some((q) => q.escala < 0.98)) return null;
  return quadros.map(({ escala, ...q }) => (escala < 0.98 ? q : { ...q, w: 0, h: 0 }));
}

const igual = (a, b) => a.escala === b.escala && a.x === b.x && a.y === b.y;

function movimentoDoClipe(movimentos, trecho) {
  const tempos = new Set([trecho.inicio, trecho.fim]);
  for (const m of movimentos) {
    for (const base of [m.inicio, m.fim - RAMPA]) {
      for (let k = 0; k <= 4; k++) tempos.add(r3(base + k * PASSO_RAMPA));
    }
  }
  const pontos = [...tempos].filter((t) => t >= trecho.inicio && t <= trecho.fim).sort((a, b) => a - b)
    .map((t) => ({ t: r3(t - trecho.inicio), ...estadoDaImagem(movimentos, t) }));
  if (pontos.every((p) => igual(p, NORMAL))) return null;
  // tira pontos do meio de patamares (iguais aos dois vizinhos)
  return pontos.filter((p, i) => i === 0 || i === pontos.length - 1 || !(igual(p, pontos[i - 1]) && igual(p, pontos[i + 1])));
}

function emPixels(el) {
  if (el.camada !== 'sobre' || !el.regiao) return { x: 0, y: 0, w: W, h: H };
  const r = el.regiao;
  return { x: Math.round((r.x / 100) * W), y: Math.round((r.y / 100) * H), w: Math.round((r.w / 100) * W), h: Math.round((r.h / 100) * H) };
}

/** Edição completa para o Editor a partir do plano validado. */
export function montarEdicao({ plano, midiaBase, edicaoId, elementosProntos = [], palavras = [], nome = 'Edição IA' }) {
  const mapa = mapaTempo(plano.manter);
  const movimentos = plano.movimentos || [];

  const clipes = plano.manter.map((tr, i) => {
    const c = {
      uid: `eia-${edicaoId}-${i}`, tipo: 'video', midia: midiaBase, inicio: tr.inicio, fim: tr.fim,
      duracaoImagem: 3, velocidade: 1, volume: 1, mudo: false, fadeIn: 0, fadeOut: 0, zoom: 'nenhum',
      transicao: { tipo: 'nenhuma', dur: 0.5 },
      filtro: { preset: '', brilho: 0, contraste: 1, saturacao: 1 },
    };
    const mov = movimentoDoClipe(movimentos, tr);
    if (mov) c.movimento = mov;
    return c;
  });

  const prontos = new Map(elementosProntos.map((e) => [e.elId, e.versao]));
  const sobreposicoes = (plano.elementos || []).filter((el) => prontos.has(el.id)).map((el) => {
    const inicio = mapa.paraEditado(el.inicio);
    const fim = mapa.paraEditado(el.fim);
    if (inicio == null || fim == null || fim <= inicio) return null;
    return { uid: `so-${edicaoId}-${el.id}`, edicaoId, elId: el.id, versao: prontos.get(el.id), inicio, fim, ...emPixels(el) };
  }).filter(Boolean);

  const palavrasEditadas = palavras.map((w) => {
    const inicio = mapa.paraEditado(w.inicio);
    const fim = mapa.paraEditado(w.fim);
    return inicio == null || fim == null ? null : { ...w, inicio, fim };
  }).filter(Boolean);

  return {
    nome, formato: '9:16', fps: 30, encaixe: 'cobrir',
    fundoMovimento: 'desfoque', corFundo: plano.estilo?.paleta?.[0] || '#000000',
    clipes, textos: [], audios: [], sobreposicoes,
    legendas: {
      ativo: true, estilo: 'capcut', tam: 'm', pos: 'base', maiusculas: true, porLegenda: 3,
      palavras: palavrasEditadas, itens: agruparLegendas(palavrasEditadas, 3),
    },
  };
}
