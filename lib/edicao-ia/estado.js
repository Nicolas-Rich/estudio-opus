// Edição IA: regras do estado salvo em disco (dados/edicoes-ia/<id>/estado.json). Puro.

const EXT_VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;

export const extensaoDeVideo = (nome) => EXT_VIDEO.test(String(nome));

/** Ao abrir o estúdio, nada está rodando: trabalho interrompido volta para a fila ou vira erro explicado. */
export function recuperarEstado(estado) {
  const e = { ...estado, elementos: { ...(estado.elementos || {}) } };
  let algumNaFila = false;
  for (const [id, el] of Object.entries(e.elementos)) {
    if (el.status === 'gerando' || el.status === 'renderizando') e.elementos[id] = { ...el, status: 'fila' };
    if (e.elementos[id].status === 'fila') algumNaFila = true;
  }
  if (e.etapa === 'gerando') e.etapa = algumNaFila ? 'pausado' : 'pronto';
  if (e.etapa === 'preparando' || e.etapa === 'planejando') {
    e.etapa = 'erro';
    e.erro = 'O estúdio foi fechado no meio do processo. Clique em "Preparar e planejar" de novo.';
  }
  return e;
}

/** Id do próximo elemento da fila, na ordem do plano (ou null). */
export function proximoElemento(plano, elementos) {
  const el = (plano?.elementos || []).find((x) => elementos?.[x.id]?.status === 'fila');
  return el ? el.id : null;
}
