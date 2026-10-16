// Camada de elementos sobrepostos (Edição IA): vídeos com transparência por cima da edição.
import { existsSync } from 'node:fs';
import path from 'node:path';

const n = (x) => String(Math.round(x * 1000) / 1000);
const idSeguro = (s) => /^[\w-]+$/.test(String(s || ''));

/**
 * Filtros de overlay para cada sobreposição { arquivo, inicio, fim, x, y, w, h } (segundos e pixels da edição).
 * indiceEntrada(arquivo) registra o arquivo como entrada do ffmpeg e devolve o índice.
 */
export function filtrosSobreposicoes({ sobreposicoes = [], rv, indiceEntrada, total }) {
  const filtros = [];
  let atual = rv;
  let k = 0;
  for (const s of sobreposicoes) {
    if (!(+s.inicio < total) || !(+s.fim > +s.inicio)) continue;
    const idx = indiceEntrada(s.arquivo);
    filtros.push(`[${idx}:v]format=rgba,setpts=PTS-STARTPTS+${n(s.inicio)}/TB,scale=${Math.round(s.w)}:${Math.round(s.h)}[ov${k}]`);
    filtros.push(`${atual}[ov${k}]overlay=${Math.round(s.x)}:${Math.round(s.y)}:enable='between(t,${n(s.inicio)},${n(s.fim)})':eof_action=pass:format=auto[so${k}]`);
    atual = `[so${k}]`;
    k++;
  }
  return { filtros, rv: atual };
}

/** Caminho do render de cada sobreposição; as que apontam para arquivo inexistente são ignoradas. */
export function resolverSobreposicoes(lista = [], pastaEdicoes, existe = existsSync) {
  return lista.map((s) => {
    if (!idSeguro(s.edicaoId) || !idSeguro(s.elId)) return null;
    const arquivo = path.join(pastaEdicoes, s.edicaoId, 'elementos', s.elId, 'render.mov');
    return existe(arquivo) ? { ...s, arquivo } : null;
  }).filter(Boolean);
}
