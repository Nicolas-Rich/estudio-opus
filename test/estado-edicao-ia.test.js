import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recuperarEstado, extensaoDeVideo, proximoElemento, nomeMidiaBase, deveMontarAutomatico } from '../lib/edicao-ia/estado.js';

test('ao reabrir, elementos em andamento voltam para a fila e a geração fica pausada', () => {
  const e = recuperarEstado({ etapa: 'gerando', elementos: { e1: { status: 'gerando' }, e2: { status: 'renderizando' }, e3: { status: 'pronto', versao: 1 } } });
  assert.deepEqual([e.elementos.e1.status, e.elementos.e2.status, e.elementos.e3.status], ['fila', 'fila', 'pronto']);
  assert.equal(e.etapa, 'pausado');
});

test('etapas sem trabalho em andamento não mudam', () => {
  assert.equal(recuperarEstado({ etapa: 'planejado', elementos: {} }).etapa, 'planejado');
});

test('preparando ou planejando interrompidos viram erro com orientação', () => {
  const e = recuperarEstado({ etapa: 'preparando', elementos: {} });
  assert.equal(e.etapa, 'erro');
  assert.match(e.erro, /fechado/);
});

test('extensões de vídeo aceitas', () => {
  assert.equal(extensaoDeVideo('foto.png'), false);
  assert.equal(extensaoDeVideo('take 1.MOV'), true);
  assert.equal(extensaoDeVideo('a.webm'), true);
});

test('próximo elemento segue a ordem do plano', () => {
  const plano = { elementos: [{ id: 'b', inicio: 1 }, { id: 'a', inicio: 2 }] };
  assert.equal(proximoElemento(plano, { a: { status: 'fila' }, b: { status: 'fila' } }), 'b');
  assert.equal(proximoElemento(plano, { a: { status: 'fila' }, b: { status: 'pronto' } }), 'a');
  assert.equal(proximoElemento(plano, { a: { status: 'pronto' }, b: { status: 'erro' } }), null);
});

test('C2: cada preparação usa um nome novo para o vídeo base na Mídia', () => {
  assert.notEqual(nomeMidiaBase('eiaabc', 'p1'), nomeMidiaBase('eiaabc', 'p2'));
  assert.match(nomeMidiaBase('eiaabc', 'p1'), /^edicao-ia-eiaabc-base-p1\.mp4$/);
});

test('I5: montar sozinho só no modo automático e com tudo pronto', () => {
  assert.equal(deveMontarAutomatico({ automatico: true, etapa: 'pronto' }), true);
  assert.equal(deveMontarAutomatico({ automatico: true, etapa: 'pausado' }), false);
  assert.equal(deveMontarAutomatico({ automatico: false, etapa: 'pronto' }), false);
});
