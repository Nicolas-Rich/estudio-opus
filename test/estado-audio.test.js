import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoAudio, assinaturaEfeitos, opcoesDaPrevia } from '../lib/rotas-audio.js';

const kit = { escala: { tonica: 'A', modo: 'maior', oitava: 5 }, timbre: 'sine', texturas: {} };
/** Projeto cuja sonoplastia (com kit) foi gerada na versão 2 da animação. */
function gerado(versaoAtual) {
  const efeitos = { lista: [{ inicio: 1, categoria: 'hit', descricao: 'x' }], kit, versaoAnalise: 2 };
  const p = { versaoAtual, ajustes: { duracao: 10 }, audio: { efeitos } };
  efeitos.assinaturaGerada = assinaturaEfeitos(estadoAudio(p).efeitos);
  return p;
}

test('sonoplastia com kit não fica pendente na mesma versão da animação', () => {
  assert.equal(estadoAudio(gerado(2)).efeitos.pendente, false);
});

test('sonoplastia com kit fica pendente quando a animação muda de versão', () => {
  assert.equal(estadoAudio({ ...gerado(2), versaoAtual: 3 }).efeitos.pendente, true);
});

test('prévia da análise sai sobre preto nas animações por cima do vídeo', () => {
  assert.equal(opcoesDaPrevia({ ajustes: { sobreVideo: true } }).fundoPreto, true);
  assert.equal(opcoesDaPrevia({ ajustes: {} }).fundoPreto, false);
});
