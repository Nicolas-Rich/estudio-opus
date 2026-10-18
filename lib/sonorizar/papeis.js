// Papel de cada momento do vídeo na sonorização e quais categorias da biblioteca servem a ele.

export const PAPEIS = {
  'item-pequeno': { categorias: ['clique', 'ui', 'tique'], duracaoMax: 0.6, volume: 0.7 },
  'item-grande': { categorias: ['impacto', 'grave'], duracaoMax: 1.5, volume: 0.9 },
  saida: { categorias: ['swish', 'whoosh'], duracaoMax: 1.5, volume: 0.6 },
  movimento: { categorias: ['whoosh', 'swish'], duracaoMax: 1.5, volume: 0.6 },
  digitacao: { categorias: ['teclado', 'tique', 'clique'], duracaoMax: 0.4, volume: 0.5 },
  corte: { categorias: ['whoosh', 'impacto'], duracaoMax: 1.5, volume: 0.8 },
};

/** Ênfase da fala: a própria categoria sugerida (impacto, brilho, whoosh, grave, riser, clique). */
export const papelEnfase = (categoria) => ({ categorias: [categoria], duracaoMax: 3, volume: 0.9 });

/** Definição de um papel qualquer (fixo ou enfase:<categoria>). */
export const definicaoDoPapel = (papel) => (papel.startsWith('enfase:') ? papelEnfase(papel.slice(7)) : PAPEIS[papel]);

/** Evento do detector → papel (ou null). */
export function papelDoEvento(e) {
  if (e.tipo === 'entra') return e.digitacao ? 'digitacao' : e.area >= 0.02 ? 'item-grande' : 'item-pequeno';
  return { sai: 'saida', move: 'movimento', corte: 'corte' }[e.tipo] || null;
}
