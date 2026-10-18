// Sugestões de sons da biblioteca para um vídeo: um mini-kit coerente por papel (favoritos e macios
// primeiro) e um clipe para cada momento (itens, cortes, ênfases), revezando os sons do kit.
import { CATEGORIAS } from '../biblioteca/classificar.js';
import { definicaoDoPapel, papelDoEvento } from './papeis.js';

const DENSIDADE = { sutil: 2, equilibrado: 3.5, intenso: 5 };
const rotulo = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c.rotulo]));
const prioridade = (papel) => (papel.startsWith('enfase:') ? 4 : papel === 'corte' ? 3 : papel === 'item-grande' ? 2 : 1);
let seq = 0;
const novoUid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Até 3 sons por papel: 10·favorito + 3·macio + 1·(fatia) − duração; sem repetir o arquivo de origem. */
export function montarKit(sons, { favoritos = new Set(), papeis = [] } = {}) {
  const kit = {};
  const faltando = [];
  for (const papel of papeis) {
    const def = definicaoDoPapel(papel);
    if (!def) continue;
    const pontos = (s) => 10 * (favoritos.has(s.id) ? 1 : 0) + 3 * (s.macio || 0) + (s.pai ? 1 : 0) - s.duracao;
    const candidatos = sons.filter((s) => def.categorias.includes(s.categoria) && s.duracao <= def.duracaoMax).sort((a, b) => pontos(b) - pontos(a));
    const escolhidos = [];
    const arquivos = new Set();
    for (const s of candidatos) {
      if (arquivos.has(s.arquivo)) continue;
      arquivos.add(s.arquivo);
      escolhidos.push(s);
      if (escolhidos.length === 3) break;
    }
    if (escolhidos.length) kit[papel] = escolhidos;
    else {
      const r = rotulo[def.categorias[0]] || def.categorias[0];
      if (!faltando.includes(r)) faltando.push(r);
    }
  }
  return { kit, faltando };
}

/** Clipes sugeridos { uid, somId, t, volume, papel } para os momentos do vídeo, em ordem de tempo. */
export function sugerirClipes({ eventos = [], cortes = [], enfases = [], kit = {}, intensidade = 'equilibrado', duracao = Infinity } = {}) {
  const momentos = [];
  for (const e of eventos) { const papel = papelDoEvento(e); if (papel) momentos.push({ t: e.t, papel }); }
  const cortesDetector = eventos.filter((e) => e.tipo === 'corte').map((e) => e.t);
  for (const t of cortes) if (!cortesDetector.some((c) => Math.abs(c - t) < 0.3)) momentos.push({ t, papel: 'corte' });
  for (const e of enfases) momentos.push({ t: e.t, papel: `enfase:${e.categoria}` });
  const validos = momentos.filter((m) => m.t >= 0 && m.t <= duracao && kit[m.papel]?.length).sort((a, b) => a.t - b.t);
  // momentos a menos de 60 ms viram um: fica o de maior prioridade
  const fundidos = [];
  for (const m of validos) {
    const u = fundidos[fundidos.length - 1];
    if (u && m.t - u.t < 0.06) { if (prioridade(m.papel) > prioridade(u.papel)) fundidos[fundidos.length - 1] = m; continue; }
    fundidos.push(m);
  }
  // densidade máxima: cota acumulada por segundo, ficam os de maior prioridade
  const porSeg = DENSIDADE[intensidade] || DENSIDADE.equilibrado;
  const ficam = [];
  const ultimo = fundidos.length ? Math.floor(fundidos[fundidos.length - 1].t) : -1;
  for (let s = 0; s <= ultimo; s++) {
    const cota = Math.floor(porSeg * (s + 1) + 1e-9) - Math.floor(porSeg * s + 1e-9);
    const doSeg = fundidos.filter((m) => m.t >= s && m.t < s + 1);
    ficam.push(...[...doSeg].sort((a, b) => prioridade(b.papel) - prioridade(a.papel) || a.t - b.t).slice(0, cota));
  }
  ficam.sort((a, b) => a.t - b.t);
  const vez = {};
  return ficam.map((m) => {
    const lista = kit[m.papel];
    const n = (vez[m.papel] = (vez[m.papel] ?? -1) + 1);
    const som = lista[n % lista.length];
    const t = m.papel === 'enfase:riser' ? Math.max(0, m.t - som.duracao) : m.t;
    return { uid: novoUid(), somId: som.id, t: Math.round(t * 1000) / 1000, volume: definicaoDoPapel(m.papel).volume, papel: m.papel };
  });
}
