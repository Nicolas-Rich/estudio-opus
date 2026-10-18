// Categoria de cada som da biblioteca: primeiro por regras (CatID UCS e palavras do nome/descrição);
// o que sobrar, o Claude classifica só pelo TEXTO, em lotes (a licença da Sonniss proíbe IA no áudio).
import { perguntarClaude } from '../claude.js';

export const CATEGORIAS = [
  { id: 'clique', rotulo: 'Clique', icone: '🖱' },
  { id: 'tique', rotulo: 'Tique', icone: '⏱' },
  { id: 'teclado', rotulo: 'Teclado', icone: '⌨' },
  { id: 'papel', rotulo: 'Papel / caneta', icone: '📝' },
  { id: 'ui', rotulo: 'Interface (UI)', icone: '📱' },
  { id: 'whoosh', rotulo: 'Whoosh', icone: '💨' },
  { id: 'swish', rotulo: 'Swish / saída', icone: '〰' },
  { id: 'impacto', rotulo: 'Impacto', icone: '💥' },
  { id: 'grave', rotulo: 'Grave / boom', icone: '🔊' },
  { id: 'riser', rotulo: 'Riser', icone: '📈' },
  { id: 'glitch', rotulo: 'Glitch', icone: '⚡' },
  { id: 'brilho', rotulo: 'Brilho / shimmer', icone: '✨' },
  { id: 'ambiente', rotulo: 'Ambiente', icone: '🌫' },
  { id: 'foley', rotulo: 'Foley', icone: '🎬' },
  { id: 'outros', rotulo: 'Outros', icone: '•' },
];
const IDS = new Set(CATEGORIAS.map((c) => c.id));

// início do CatID → categoria (a primeira que casa vence)
const POR_CATID = [
  ['UI', (t) => (/\bclicks?\b/i.test(t) ? 'clique' : 'ui')],
  ['WHSH', 'whoosh'], ['SWSH', 'swish'], ['PAPR', 'papel'],
  ['IMPT', 'impacto'], ['DSGNImpt', 'impacto'], ['HIT', 'impacto'],
  ['BOOM', 'grave'], ['DSGNBoom', 'grave'], ['SUB', 'grave'],
  ['RISR', 'riser'], ['DSGNRise', 'riser'],
  ['GLTCH', 'glitch'], ['DSGNGlch', 'glitch'], ['ELEC', (t) => (/\bglitch/i.test(t) ? 'glitch' : null)],
  ['AMB', 'ambiente'], ['MAGC', 'brilho'], ['DSGNShmr', 'brilho'],
  ['FOLY', 'foley'], ['CLTH', 'foley'], ['OBJ', 'foley'],
];
// palavras (inglês e português) → categoria, na ordem da spec
const POR_PALAVRA = [
  ['teclado', /\b(typewriter|keyboard|keystrokes?|key ?press(es)?|teclado|teclas?)\b/i],
  ['clique', /\b(clicks?|buttons?|switch(es)?|cliques?|bot[aã]o)\b/i],
  ['tique', /\b(ticks?|tocks?|clocks?|rel[oó]gio)\b/i],
  ['papel', /\b(paper|pens?|pencils?|markers?|pages?|papel|caneta|l[aá]pis)\b/i],
  ['whoosh', /\b(whoosh(es)?|swoosh(es)?|swipes?|pass-?by)\b/i],
  ['impacto', /\b(impacts?|hits?|punch(es)?|slams?|impacto)\b/i],
  ['grave', /\b(booms?|sub ?drops?|low hits?)\b/i],
  ['riser', /\b(risers?|rises?|build(s|up)?)\b/i],
  ['glitch', /\b(glitch(es|y)?|data|stutters?)\b/i],
  ['brilho', /\b(shimmers?|sparkles?|magic|twinkles?|brilho)\b/i],
  ['ambiente', /\b(ambiences?|ambiances?|room ?tones?|atmos(phere)?|ambiente)\b/i],
];
const TAGS = [
  [/\bsoft\b/i, 'suave'], [/\bwood(en)?\b/i, 'madeira'], [/\bmetal(lic)?\b/i, 'metal'], [/\bheavy\b/i, 'pesado'],
  [/\blight\b/i, 'leve'], [/\bglass\b/i, 'vidro'], [/\bplastic\b/i, 'plástico'], [/\b(fast|quick)\b/i, 'rápido'],
  [/\bslow\b/i, 'lento'], [/\bdeep\b/i, 'grave'], [/\bbright\b/i, 'brilhante'], [/\bdigital\b/i, 'digital'],
  [/\bretro\b/i, 'retrô'], [/\bmechanical\b/i, 'mecânico'], [/\bwater\b/i, 'água'], [/\bair\b/i, 'ar'],
  [/\bshort\b/i, 'curto'], [/\blong\b/i, 'longo'],
];
const tagsDe = (texto) => [...new Set(TAGS.filter(([re]) => re.test(texto)).map(([, t]) => t))].slice(0, 5);

/** Categoria por regras; null quando nenhuma casa (o Claude decide depois). */
export function categoriaPorRegras({ ucs, nome = '', descricao = '' }) {
  // a subcategoria UCS vem colada na família (UIClick → "UI Click"): separa para as palavras casarem
  const sub = ucs?.catId ? `${ucs.familia} ${ucs.catId.slice(ucs.familia.length)}` : '';
  const texto = `${sub} ${nome.replace(/[_.]/g, ' ')} ${descricao}`;
  let categoria = null;
  if (ucs?.catId) {
    for (const [prefixo, cat] of POR_CATID) {
      if (!ucs.catId.startsWith(prefixo)) continue;
      categoria = typeof cat === 'function' ? cat(texto) : cat;
      if (categoria) break;
    }
  }
  if (!categoria) categoria = POR_PALAVRA.find(([, re]) => re.test(texto))?.[0] || null;
  return categoria ? { categoria, tags: tagsDe(texto) } : null;
}

function extrairLista(texto) {
  const bloco = /```(?:json)?\s*([\s\S]*?)```/i.exec(texto);
  const bruto = bloco ? bloco[1] : texto.slice(texto.indexOf('['), texto.lastIndexOf(']') + 1);
  try { const v = JSON.parse(bruto); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Classifica pelo texto, em lotes de 150. Qualquer falha deixa os itens em "outros". */
export async function classificarComClaude(itens, { perguntar = perguntarClaude, modelo = 'claude-sonnet-5-5', sinal } = {}) {
  const out = new Map(itens.map((i) => [i.id, { categoria: 'outros', tags: [] }]));
  for (let k = 0; k < itens.length; k += 150) {
    const lote = itens.slice(k, k + 150);
    const pedido = [
      'Classifique cada efeito sonoro de uma biblioteca profissional SÓ pelo nome e descrição.',
      `Categorias permitidas: ${CATEGORIAS.map((c) => c.id).join(', ')}.`,
      'Para cada um devolva a categoria e até 5 tags curtas EM PORTUGUÊS (material, caráter, peso).',
      'Responda SOMENTE com um bloco json: [{"id":"…","categoria":"…","tags":["…"]}]',
      '',
      ...lote.map((i) => `${i.id} | ${i.nome} | ${i.descricao || ''}`),
    ].join('\n');
    try {
      const r = await perguntar({ sistema: 'Você é um bibliotecário de efeitos sonoros. Responda só com JSON.', pedido, modelo, sinal });
      for (const x of extrairLista(r?.texto || '')) {
        if (!out.has(x?.id)) continue;
        out.set(x.id, {
          categoria: IDS.has(x.categoria) ? x.categoria : 'outros',
          tags: (Array.isArray(x.tags) ? x.tags : []).map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 5),
        });
      }
    } catch { /* lote fica em "outros" */ }
  }
  return out;
}
