// Catálogo da biblioteca de efeitos: indexa cada som de um pacote (metadados, categoria por regras,
// medidas, mini-onda e fatias de arquivos com vários golpes) e busca por texto e filtros.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FFPROBE } from '../ffmpeg.js';
import { lerPcm } from '../faixa-itens.js';
import { lerNomeUcs } from './ucs.js';
import { CATEGORIAS, categoriaPorRegras } from './classificar.js';
import { medirSom, fatiar, miniOnda, macioDe } from './medidas.js';

const SR = 48000;
const EXT = /\.(wav|mp3|flac|ogg|aiff?)$/i;
const ARQ = 'catalogo.json';
const r3 = (v) => Math.round(v * 1000) / 1000;
export const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const idDe = (arquivo, inicio) => createHash('sha1').update(`${arquivo}#${inicio ?? ''}`).digest('hex').slice(0, 12);
const rotulo = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c.rotulo]));

function sondarArquivo(abs) {
  return new Promise((ok) => {
    // o ffprobe empacotado não abre caminhos com mais de 260 caracteres no Windows: o prefixo \\?\ resolve
    const alvo = process.platform === 'win32' ? '\\\\?\\' + path.resolve(abs) : abs;
    execFile(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:format_tags=comment,description,title', '-of', 'json', alvo],
      { windowsHide: true }, (erro, saida) => {
        if (erro) return ok(null);
        try {
          const f = JSON.parse(saida).format || {};
          const duracao = +f.duration;
          if (!Number.isFinite(duracao) || duracao <= 0) return ok(null);
          const t = f.tags || {};
          ok({ duracao, descricao: String(t.comment || t.description || t.title || '').trim().slice(0, 300) });
        } catch { ok(null); }
      });
  });
}

const medidasDe = (pcm) => {
  const m = medirSom(pcm, SR);
  return { medidas: { ataqueMs: m.ataqueMs, brilho: r3(m.brilho), aspereza: r3(m.aspereza), pico: r3(m.pico), rms: r3(m.rms) }, macio: r3(macioDe(m.aspereza)), onda: miniOnda(pcm) };
};

/** Indexa todos os áudios de uma pasta de pacote. Devolve { sons, arquivos, fatias, pulados }. */
export async function indexarPacote({ raiz, pasta, pacote, aoProgresso, sinal }) {
  const lista = (await fs.readdir(pasta, { recursive: true })).filter((r) => EXT.test(r)).sort();
  const sons = [];
  let arquivos = 0, fatias = 0, pulados = 0;
  for (let k = 0; k < lista.length; k++) {
    if (sinal?.aborted) throw new Error('Importação cancelada');
    if (k % 20 === 0) aoProgresso?.(k, lista.length);
    const abs = path.join(pasta, lista[k]);
    const arquivo = path.relative(raiz, abs).split(path.sep).join('/');
    const info = await sondarArquivo(abs);
    let pcm = null;
    if (info) {
      try {
        const [L, R] = await lerPcm(abs, 'atrim=0:60');
        pcm = new Float32Array(L.length);
        for (let i = 0; i < L.length; i++) pcm[i] = (L[i] + R[i]) / 2;
      } catch { pcm = null; }
    }
    if (!info || !pcm?.length) { pulados++; continue; }
    const nome = path.basename(abs).replace(/\.[^.]+$/, '');
    const ucs = lerNomeUcs(nome + '.wav');
    const regra = categoriaPorRegras({ ucs, nome, descricao: info.descricao });
    const pai = {
      id: idDe(arquivo, null), pacote, arquivo, inicio: null, fim: null, pai: null, nome, descricao: info.descricao, ucs,
      duracao: r3(info.duracao), ...medidasDe(pcm), categoria: regra?.categoria ?? null, tags: regra?.tags ?? [],
    };
    sons.push(pai);
    arquivos++;
    // golpes individuais: só em arquivos de até 60 s (o PCM já vem cortado em 60 s)
    const golpes = info.duracao <= 60 ? fatiar(pcm, SR) : [];
    golpes.forEach((g, n) => {
      const trecho = pcm.subarray(Math.round(g.inicio * SR), Math.round(g.fim * SR));
      sons.push({
        ...pai, id: idDe(arquivo, r3(g.inicio)), inicio: r3(g.inicio), fim: r3(g.fim), pai: pai.id,
        nome: `${nome} (golpe ${n + 1})`, duracao: r3(g.fim - g.inicio), ...medidasDe(trecho),
      });
      fatias++;
    });
  }
  aoProgresso?.(lista.length, lista.length);
  return { sons, arquivos, fatias, pulados };
}

const DURACAO = { curto: (d) => d < 0.6, medio: (d) => d >= 0.6 && d <= 3, longo: (d) => d > 3 };

/** Busca por palavras (todas obrigatórias, sem acento) e filtros; com texto, ordena por relevância. */
export function buscar(sons, { q = '', categoria, duracao, macio, favoritos = new Set(), soFavoritos = false, pagina = 0, porPagina = 60 } = {}) {
  const palavras = semAcento(q).split(/\s+/).filter(Boolean);
  const res = [];
  for (const s of sons) {
    if (categoria && s.categoria !== categoria) continue;
    if (duracao && DURACAO[duracao] && !DURACAO[duracao](s.duracao)) continue;
    if (macio === 'macio' && !(s.macio >= 0.6)) continue;
    if (macio === 'aspero' && !(s.macio <= 0.4)) continue;
    if (soFavoritos && !favoritos.has(s.id)) continue;
    let pontos = 0;
    if (palavras.length) {
      const nome = semAcento(s.nome);
      const resto = semAcento(`${s.descricao} ${(s.tags || []).join(' ')} ${rotulo[s.categoria] || ''}`);
      let todas = true;
      for (const p of palavras) {
        if (nome.includes(p)) pontos += 2;
        else if (resto.includes(p)) pontos += 1;
        else { todas = false; break; }
      }
      if (!todas) continue;
    }
    res.push({ s, pontos, fav: favoritos.has(s.id) ? 1 : 0 });
  }
  res.sort((a, b) => b.pontos - a.pontos || b.fav - a.fav || a.s.nome.localeCompare(b.s.nome));
  return { total: res.length, itens: res.slice(pagina * porPagina, (pagina + 1) * porPagina).map((r) => r.s) };
}

export function contarCategorias(sons) {
  const c = {};
  for (const s of sons) c[s.categoria] = (c[s.categoria] || 0) + 1;
  return c;
}

/** Catálogo vazio só se ainda não existe; um arquivo ilegível dá erro (nunca vira "biblioteca vazia" e é sobrescrito). */
export async function lerCatalogo(raiz) {
  let texto;
  try { texto = await fs.readFile(path.join(raiz, ARQ), 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { versao: 1, pacotes: [], sons: [] };
    throw new Error(`Não consegui ler o catálogo da biblioteca (${e.code || e.message}). Nada foi alterado.`);
  }
  try { return JSON.parse(texto); } catch {
    throw new Error('O catálogo da biblioteca está corrompido. Nada foi alterado.');
  }
}
/** Grava num arquivo temporário e troca de uma vez: uma queda no meio não corrompe o catálogo. */
export async function gravarCatalogo(raiz, catalogo) {
  await fs.mkdir(raiz, { recursive: true });
  const tmp = path.join(raiz, ARQ + '.tmp');
  await fs.writeFile(tmp, JSON.stringify(catalogo));
  await fs.rename(tmp, path.join(raiz, ARQ));
}
