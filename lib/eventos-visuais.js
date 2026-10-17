// Detector de itens da animação, por imagem (funciona com DOM, canvas e animação por cima de vídeo):
// cada item que ENTRA, SAI ou SE MOVE vira um evento, para a sonoplastia dar um som a cada um.
// A animação é reduzida a uma grade (48 colunas, 15 fps); cada mancha que se destaca do fundo é um
// item, acompanhado quadro a quadro (assim um item andando não vira várias "entradas").
import { spawn } from 'node:child_process';
import { FFMPEG, sondar } from './ffmpeg.js';

const LIMIAR_FUNDO = 20;   // distância do fundo para a célula ser "item"
const LIMIAR_CORTE = 0.6;  // fração de células mudando num quadro = corte de cena
const AGITADO = 40;        // mudança mediana por quadro acima disso = partícula/ruído, não item
const CONFIRMA = 3;        // quadros seguidos para um item contar (filtra cintilação)
const AREA_MIN = 2;        // células
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
  let inicioCena = 0;
  let trilhas = [];

  for (let i = 0; i < quadros.length; i++) {
    const q = quadros[i];
    const ant = quadros[Math.max(0, i - 1)];
    // corte de cena: quase tudo muda de uma vez
    let mudou = 0;
    for (let k = 0; k < N; k++) if (dist(q, k * 3, ant, k * 3) > 10) mudou++;
    if (i && mudou > LIMIAR_CORTE * N) {
      ev(i, 'corte', C / 2, L / 2, N);
      fundo = Float32Array.from(q);
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
          quadros: 0, agitados: 0, confirmado: false, ruido: false, movendo: false });
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
      // crescimento no lugar (texto sendo digitado letra a letra): cada pedaço novo é uma entrada
      if (tr.confirmado && !tr.ruido && cel.length - tr.area >= 2 && mantidas >= 0.8 * tr.area && novas.length >= 2) {
        const c = centro(novas, C);
        ev(i, 'entra', c.cx, c.cy, novas.length, { digitacao: true });
      }
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
      if (!tr.confirmado && tr.visto >= CONFIRMA && tr.quadros >= 2) {
        tr.confirmado = true;
        if (!tr.ruido && tr.ini !== inicioCena) ev(tr.ini, 'entra', cx, cy, cel.length);
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
      if (tr.faltas === CONFIRMA && tr.confirmado && !tr.ruido) ev((tr.ultimo ?? tr.ini) + 1, 'sai', tr.cx, tr.cy, tr.area);
    });
    trilhas = trilhas.filter((tr) => tr.faltas < CONFIRMA || !tr.confirmado ? tr.faltas < CONFIRMA : false);
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
