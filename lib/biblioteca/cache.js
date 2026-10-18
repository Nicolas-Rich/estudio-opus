// Catálogo da biblioteca de efeitos em memória, compartilhado pela aba Efeitos (biblioteca e sonorizar).
// Recarregado do disco só quando invalidado (depois de cada importação).
import { lerCatalogo } from './catalogo.js';

const cache = new Map();

/** { catalogo, porId } da biblioteca em `raiz`. */
export async function obterCatalogo(raiz) {
  if (!cache.has(raiz)) {
    cache.set(raiz, lerCatalogo(raiz).then((catalogo) => ({ catalogo, porId: new Map(catalogo.sons.map((s) => [s.id, s])) }))
      .catch((e) => { cache.delete(raiz); throw e; }));
  }
  return cache.get(raiz);
}

export function invalidarCatalogo() {
  cache.clear();
}
