// Detector de itens da animação, por imagem (funciona com DOM, canvas e animação por cima de vídeo):
// cada item que ENTRA, SAI ou SE MOVE vira um evento, para a sonoplastia dar um som a cada um.
// A animação é reduzida a uma grade (48 colunas, 15 fps); cada mancha que se destaca do fundo é um
// item, acompanhado quadro a quadro (assim um item andando não vira várias "entradas").
import { spawn } from 'node:child_process';
import { FFMPEG, sondar } from './ffmpeg.js';

/** Muda quando o detector muda: análises em cache com outra versão são refeitas. */
export const VERSAO_DETECTOR = 2;

const LIMIAR_FUNDO = 20;   // distância do fundo para a célula ser "item"
const LIMIAR_CORTE = 0.6;  // fração de células mudando num quadro = corte de cena
const AGITADO = 40;        // mudança mediana por quadro acima disso = partícula/ruído, não item
const CONFIRMA = 3;        // quadros sem a mancha para o item ter saído
const VIDA_ENTRA = 6;      // quadros seguidos (0,4 s) para um item contar como entrada (filtra cintilação/partículas)
const VIDA_SAI = 9;        // só soa a saída de quem viveu ≥ 0,6 s
const AREA_MIN = 4;        // células
const PEDACO = 8;          // pedaço anexado a um lado com ≥ 8 células = item novo (card empilhado), não letra
const GRUPO_S = 0.6;       // entradas até 0,6 s uma da outra = mesmo grupo (escadinha)

const dist = (a, i, b, j) => Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]));
const mediana = (v) => { const s = [...v].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : 0; };

/** Manchas (8-conexas) de células marcadas, com área ≥ AREA_MIN. */
function manchas(mascara, C, L) {
  const visto = new Uint8Array(C * L);
  const out = [];
  for (let k0 = 0; k0 < C * L; k0++) {
    if (!mascara[k0] || visto[k0]) continue;
    const celulas = [];
    const pilha = [k0];
    visto[k0] = 1;
    while (pilha.length) {
      const k = pilha.pop();
      celulas.push(k);
      const x = k % C, y = (k / C) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= C || ny >= L) continue;
        const n = ny * C + nx;
        if (mascara[n] && !visto[n]) { visto[n] = 1; pilha.push(n); }
      }
    }
    if (celulas.length >= AREA_MIN) out.push(celulas);
  }
  return out;
}
/** Cor mais comum da cena (fundo dominante), quantizada. */
function corDominante(q, N) {
  const conta = new Map();
  let melhor = null, max = 0;
  for (let k = 0; k < N; k++) {
    const chave = ((q[k * 3] >> 4) << 8) | ((q[k * 3 + 1] >> 4) << 4) | (q[k * 3 + 2] >> 4);
    const n = (conta.get(chave) || 0) + 1;
    conta.set(chave, n);
    if (n > max) { max = n; melhor = [q[k * 3], q[k * 3 + 1], q[k * 3 + 2]]; }
  }
  return melhor;
}
const bbox = (celulas, C) => {
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (const k of celulas) { const x = k % C, y = (k / C) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, x1, y0, y1 };
};
/** De que lado da mancha anterior as células novas cresceram ('esq'|'dir'|'cima'|'baixo'), ou null se em volta. */
function ladoDoCrescimento(novas, antes, C) {
  const b = bbox(antes, C);
  const xs = novas.map((k) => k % C), ys = novas.map((k) => (k / C) | 0);
  if (xs.every((x) => x > b.x1)) return 'dir';
  if (xs.every((x) => x < b.x0)) return 'esq';
  if (ys.every((y) => y > b.y1)) return 'baixo';
  if (ys.every((y) => y < b.y0)) return 'cima';
  return null;
}
const centro = (celulas, C) => {
  let sx = 0, sy = 0;
  for (const k of celulas) { sx += k % C; sy += (k / C) | 0; }
  return { cx: sx / celulas.length + 0.5, cy: sy / celulas.length + 0.5 };
};

/**
 * quadros: Uint8Array RGB da grade (colunas × linhas), um por quadro.
 * Devolve [{ t, tipo: 'entra'|'sai'|'move'|'corte', x, y, area, grupo, dir, digitacao }] em ordem de tempo.
 */
export function detectarEventos(quadros, { colunas: C, linhas: L, fps }) {
  const N = C * L;
  const eventos = [];
  if (!quadros.length) return eventos;
  const ev = (i, tipo, cx, cy, area, extra = {}) => eventos.push({
    t: i / fps, tipo, x: cx / C, y: cy / L, area: area / N, grupo: null, dir: 0, digitacao: false, ...extra,
  });
  let fundo = Float32Array.from(quadros[0]);
  let dominante = corDominante(quadros[0], N);
  let inicioCena = 0;
  let trilhas = [];
  const pertoDe = (cor, j, alvo, lim) => Math.max(Math.abs(cor[j] - alvo[0]), Math.abs(cor[j + 1] - alvo[1]), Math.abs(cor[j + 2] - alvo[2])) <= lim;
  /** A mancha passa a ser fundo; trilhas que estavam ali somem sem som. */
  const absorver = (cel, q) => {
    const set = new Set(cel);
    for (const k of cel) for (let c = 0; c < 3; c++) fundo[k * 3 + c] = q[k * 3 + c];
    trilhas = trilhas.filter((tr) => { let n = 0; for (const k of tr.celulas) if (set.has(k)) n++; return n < 0.5 * tr.celulas.size; });
  };

  for (let i = 0; i < quadros.length; i++) {
    const q = quadros[i];
    const ant = quadros[Math.max(0, i - 1)];
    // corte de cena: quase tudo muda de uma vez
    let mudou = 0;
    for (let k = 0; k < N; k++) if (dist(q, k * 3, ant, k * 3) > 10) mudou++;
    if (i && mudou > LIMIAR_CORTE * N) {
      ev(i, 'corte', C / 2, L / 2, N);
      fundo = Float32Array.from(q);
      dominante = corDominante(q, N);
      inicioCena = i;
      trilhas = [];
      continue;
    }
    // o que se destaca do fundo; o fundo acompanha devagar as mudanças lentas onde não há item
    const mascara = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      const j = k * 3;
      if (dist(q, j, fundo, j) > LIMIAR_FUNDO) mascara[k] = 1;
      else for (let c = 0; c < 3; c++) fundo[j + c] += 0.05 * (q[j + c] - fundo[j + c]);
    }
    // casa cada mancha com a trilha (item) do quadro anterior: maior sobreposição, senão o centro mais próximo
    const dono = new Int32Array(N).fill(-1);
    trilhas.forEach((tr, idx) => { if (tr.faltas === 0) for (const k of tr.celulas) dono[k] = idx; });
    const usadas = new Set();
    const lista = manchas(mascara, C, L).sort((a, b) => b.length - a.length);
    for (const cel of lista) {
      const { cx, cy } = centro(cel, C);
      // mudança do fundo (wipe, painel entrando pela borda, fade da cena): vira fundo, sem som de item
      const b = bbox(cel, C);
      const bordas = (b.x0 === 0) + (b.x1 === C - 1) + (b.y0 === 0) + (b.y1 === L - 1);
      if (cel.length > 0.35 * N || (cel.length > 0.1 * N && bordas >= 3)) {
        absorver(cel, q);
        dominante = corDominante(q, N);
        continue;
      }
      // fundo revelado (um item que estava na cena desde o começo saiu): é saída, e o lugar volta a ser fundo
      if (cel.filter((k) => pertoDe(q, k * 3, dominante, 25) && !pertoDe(fundo, k * 3, dominante, 25)).length >= 0.8 * cel.length) {
        ev(i, 'sai', cx, cy, cel.length);
        absorver(cel, q);
        continue;
      }
      const votos = new Map();
      for (const k of cel) if (dono[k] >= 0) votos.set(dono[k], (votos.get(dono[k]) || 0) + 1);
      let idx = -1, melhor = 0;
      for (const [t, n] of votos) if (!usadas.has(t) && n > melhor) { idx = t; melhor = n; }
      if (idx < 0) {
        let dMin = 4;
        trilhas.forEach((tr, t) => {
          if (usadas.has(t) || tr.faltas >= CONFIRMA) return;
          const d = Math.hypot(tr.cx - cx, tr.cy - cy);
          const razao = cel.length / tr.area;
          if (d <= dMin && razao >= 0.5 && razao <= 2) { dMin = d; idx = t; }
        });
      }
      if (idx < 0) {
        trilhas.push({ ini: i, visto: 1, faltas: 0, celulas: new Set(cel), cx, cy, area: cel.length, hist: [[i, cx, cy, cel.length]],
          quadros: 0, agitados: 0, confirmado: false, ruido: false, movendo: false, pendentes: [], parado: 1 });
        usadas.add(trilhas.length - 1);
        continue;
      }
      usadas.add(idx);
      const tr = trilhas[idx];
      const antes = tr.celulas;
      const novas = cel.filter((k) => !antes.has(k));
      const mantidas = cel.length - novas.length;
      // agitação só nas células que já eram do item (as que acabaram de surgir sempre mudam muito)
      const agitacao = mantidas ? mediana(cel.filter((k) => antes.has(k)).map((k) => dist(q, k * 3, ant, k * 3))) : 0;
      // crescimento num lado só: texto sendo digitado (linha baixa crescendo na horizontal, pedaços pequenos)
      // ou um item novo colado a outro (card empilhado). Zoom/fade crescem em volta e não contam.
      if (!tr.ruido && novas.length >= 2 && mantidas >= 0.8 * tr.area) {
        const lado = ladoDoCrescimento(novas, antes, C);
        const altura = b.y1 - b.y0 + 1;
        const extra = (lado === 'esq' || lado === 'dir') && altura <= 3 && novas.length < PEDACO ? { digitacao: true }
          : lado && novas.length >= PEDACO ? { digitacao: false } : null;
        if (extra) {
          const c = centro(novas, C);
          if (tr.confirmado) ev(i, 'entra', c.cx, c.cy, novas.length, extra);
          else tr.pendentes.push([i, c.cx, c.cy, novas.length, extra]);
        }
      }
      // parado = manteve o lugar (partícula anda o tempo todo; ícone/item de lista pousa e fica)
      tr.parado = mantidas >= 0.7 * tr.area ? tr.parado + 1 : 0;
      Object.assign(tr, { celulas: new Set(cel), cx, cy, area: cel.length, faltas: 0, ultimo: i });
      tr.visto++;
      // só quadros em que a mancha se sobrepõe a si mesma dizem se é item estável ou ruído
      if (mantidas) {
        tr.quadros++;
        if (agitacao > AGITADO) tr.agitados++;
        tr.ruido = tr.agitados / tr.quadros > 0.6;
      }
      tr.hist.push([i, cx, cy, cel.length]);
      if (tr.hist.length > 6) tr.hist.shift();
      const pequeno = cel.length < 0.01 * N;
      if (!tr.confirmado && tr.visto >= VIDA_ENTRA && tr.quadros >= 2 && (!pequeno || tr.parado >= VIDA_ENTRA)) {
        tr.confirmado = true;
        if (!tr.ruido && tr.ini !== inicioCena) {
          ev(tr.ini, 'entra', cx, cy, tr.hist[0][3]);
          // letras/pedaços que surgiram antes de o item se confirmar
          for (const [pi, px, py, pa, extra] of tr.pendentes) ev(pi, 'entra', px, py, pa, extra);
        }
      }
      // movimento: o centro andou mais de 3 células nos últimos 5 quadros
      if (tr.confirmado && !tr.ruido && tr.hist.length >= 5) {
        const [i0, x0, y0, a0] = tr.hist[tr.hist.length - 5];
        const dx = cx - x0, dy = cy - y0;
        const d = Math.hypot(dx, dy);
        // crescendo (texto sendo digitado) também desloca o centro: só é movimento com a área estável
        const areaEstavel = Math.abs(cel.length - a0) <= 0.3 * a0;
        if (!tr.movendo && d > 3 && areaEstavel) {
          tr.movendo = true;
          ev(i0, 'move', cx, cy, cel.length, { dir: Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0 });
        } else if (tr.movendo && d < 1) tr.movendo = false;
      }
    }
    // trilhas que sumiram por CONFIRMA quadros saíram
    trilhas.forEach((tr, t) => {
      if (usadas.has(t)) return;
      tr.faltas++;
      tr.visto = 0;
      if (tr.faltas === CONFIRMA && tr.confirmado && !tr.ruido && (tr.ultimo ?? tr.ini) - tr.ini >= VIDA_SAI) ev((tr.ultimo ?? tr.ini) + 1, 'sai', tr.cx, tr.cy, tr.area);
    });
    trilhas = trilhas.filter((tr) => tr.faltas < CONFIRMA);
  }

  eventos.sort((a, b) => a.t - b.t);
  // grupos (escadinha) e digitação: entradas próximas no tempo; ≥ 4 pequenas na mesma linha = digitação
  const entradas = eventos.filter((e) => e.tipo === 'entra');
  let g = -1, ultimo = -Infinity;
  for (const e of entradas) { if (e.t - ultimo > GRUPO_S) g++; e.grupo = g; ultimo = e.t; }
  for (let k = 0; k <= g; k++) {
    const doGrupo = entradas.filter((e) => e.grupo === k && e.area < 0.02);
    if (doGrupo.length < 4) continue;
    const ys = doGrupo.map((e) => e.y);
    if (Math.max(...ys) - Math.min(...ys) < 1 / L) for (const e of doGrupo) e.digitacao = true;
  }
  return eventos;
}

/** Texto curto (português) dos eventos, para o Claude planejar o som. */
export function resumirEventos(eventos, duracao) {
  const n = (tipo) => eventos.filter((e) => e.tipo === tipo).length;
  const grupos = new Set(eventos.filter((e) => e.grupo != null).map((e) => e.grupo)).size;
  const digitacoes = new Set(eventos.filter((e) => e.digitacao).map((e) => e.grupo)).size;
  const L = [
    `${eventos.length} eventos detectados (${n('entra')} entradas, ${n('sai')} saídas, ${n('move')} movimentos, ${n('corte')} cortes) — `
      + `${(eventos.length / Math.max(1, duracao)).toFixed(1)} por segundo em média.`,
    `${grupos} grupos de entradas em sequência (escadinhas); ${digitacoes} trechos de digitação.`,
  ];
  const escolhidos = eventos.length <= 40 ? eventos
    : [...eventos].sort((a, b) => (b.tipo === 'corte') - (a.tipo === 'corte') || b.area - a.area).slice(0, 40).sort((a, b) => a.t - b.t);
  if (eventos.length > 40) L.push('Os 40 mais marcantes (cortes e maiores itens):');
  for (const e of escolhidos) {
    L.push(`- ${e.t.toFixed(2)} s ${e.tipo} (x ${e.x.toFixed(2)}, y ${e.y.toFixed(2)}, área ${(e.area * 100).toFixed(1)}%)`
      + `${e.grupo != null ? ` grupo ${e.grupo}` : ''}${e.digitacao ? ' [digitação]' : ''}${e.dir ? ` dir ${e.dir > 0 ? '→' : '←'}` : ''}`);
  }
  return L.join('\n');
}

/** Lê um vídeo como quadros da grade (rgb24, 15 fps, 48 colunas). */
export async function quadrosDoVideo(video, { colunas = 48, fps = 15 } = {}) {
  const info = await sondar(video);
  const linhas = Math.max(2, Math.round((colunas * (info.altura || 9)) / (info.largura || 16)));
  const tam = colunas * linhas * 3;
  return new Promise((ok, falha) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', video,
      '-vf', `fps=${fps},scale=${colunas}:${linhas}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const partes = [];
    let err = '';
    p.stdout.on('data', (d) => partes.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', falha);
    p.on('close', (c) => {
      if (c !== 0) return falha(new Error('ffmpeg (quadros): ' + err.slice(-400)));
      const tudo = Buffer.concat(partes);
      const quadros = [];
      for (let o = 0; o + tam <= tudo.length; o += tam) quadros.push(new Uint8Array(tudo.buffer, tudo.byteOffset + o, tam));
      ok({ quadros, colunas, linhas, fps });
    });
  });
}
