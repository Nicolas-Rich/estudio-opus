import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarPlano, extrairJson } from '../lib/edicao-ia/plano.js';

const estilo = { paleta: ['#000000', '#7c5cff', '#ffffff'], fonte: 'Inter', clima: 'escuro' };
const el = (id, inicio, fim, extra = {}) => ({ id, inicio, fim, camada: 'sobre', regiao: { x: 10, y: 10, w: 80, h: 20 }, ancora: null, descricao: 'algo', textoNaTela: '', ...extra });
const plano = (extra = {}) => ({ estilo, manter: [{ inicio: 0, fim: 5 }, { inicio: 6, fim: 10 }], movimentos: [], elementos: [], ...extra });

test('plano válido passa intacto', () => {
  const bruto = plano({ movimentos: [{ inicio: 1, fim: 2, tipo: 'zoom', escala: 1.25 }], elementos: [el('e1', 1, 3)] });
  const { plano: p, avisos } = validarPlano(structuredClone(bruto), { duracao: 10 });
  assert.deepEqual(avisos, []);
  assert.deepEqual(p, bruto);
});

test('tempos fora da duração são cortados', () => {
  const { plano: p, avisos } = validarPlano(plano({ manter: [{ inicio: -1, fim: 50 }] }), { duracao: 30 });
  assert.deepEqual(p.manter, [{ inicio: 0, fim: 30 }]);
  assert.equal(avisos.length, 1);
});

test('trechos sobrepostos em manter são unidos', () => {
  const { plano: p } = validarPlano(plano({ manter: [{ inicio: 0, fim: 5 }, { inicio: 4, fim: 8 }] }), { duracao: 10 });
  assert.deepEqual(p.manter, [{ inicio: 0, fim: 8 }]);
});

test('manter vazio lança', () => {
  assert.throws(() => validarPlano({ manter: [] }, { duracao: 10 }), /manter/);
});

test('soma de manter abaixo de 30 % lança', () => {
  assert.throws(() => validarPlano(plano({ manter: [{ inicio: 0, fim: 2 }] }), { duracao: 10 }), /30/);
});

test('elemento que começa num trecho cortado é descartado', () => {
  const { plano: p, avisos } = validarPlano(plano({ manter: [{ inicio: 0, fim: 5 }, { inicio: 8, fim: 10 }], elementos: [el('e9', 6, 9)] }), { duracao: 10 });
  assert.equal(p.elementos.length, 0);
  assert.ok(avisos.some((a) => a.includes('e9')));
});

test('elemento que atravessa um corte é encurtado ao trecho onde começa', () => {
  const { plano: p } = validarPlano(plano({ manter: [{ inicio: 0, fim: 5 }, { inicio: 8, fim: 10 }], elementos: [el('e1', 4, 9)] }), { duracao: 10 });
  assert.deepEqual([p.elementos[0].inicio, p.elementos[0].fim], [4, 5]);
});

test('tipo de movimento e camada desconhecidos são descartados; regiao é limitada a 0–100', () => {
  const { plano: p } = validarPlano(plano({
    movimentos: [{ inicio: 1, fim: 2, tipo: 'voar' }],
    elementos: [el('e1', 1, 2, { camada: 'flutuante' }), el('e2', 1, 2, { regiao: { x: -5, y: 90, w: 120, h: 30 } })],
  }), { duracao: 10 });
  assert.equal(p.movimentos.length, 0);
  assert.deepEqual(p.elementos.map((e) => e.id), ['e2']);
  assert.deepEqual(p.elementos[0].regiao, { x: 0, y: 90, w: 100, h: 10 });
});

test('ids repetidos ganham sufixo', () => {
  const { plano: p } = validarPlano(plano({ elementos: [el('a', 1, 2), el('a', 2, 3)] }), { duracao: 10 });
  assert.deepEqual(p.elementos.map((e) => e.id), ['a', 'a-2']);
});

test('mais de 25 elementos ou 12 movimentos são cortados, mantendo os primeiros no tempo', () => {
  const elementos = Array.from({ length: 30 }, (_, i) => el(`e${i}`, 4.9 - i * 0.1, 4.95 - i * 0.1));
  const movimentos = Array.from({ length: 15 }, (_, i) => ({ inicio: 4.8 - i * 0.3, fim: 4.9 - i * 0.3, tipo: 'zoom', escala: 1.2 }));
  const { plano: p } = validarPlano(plano({ elementos, movimentos }), { duracao: 10 });
  assert.equal(p.elementos.length, 25);
  assert.equal(p.movimentos.length, 12);
  assert.ok(p.elementos[0].inicio <= p.elementos[24].inicio);
  assert.equal(p.movimentos[0].inicio, Math.min(...movimentos.map((m) => m.inicio)));
});

test('estilo ausente recebe o padrão', () => {
  const { plano: p } = validarPlano({ manter: [{ inicio: 0, fim: 10 }] }, { duracao: 10 });
  assert.deepEqual(p.estilo.paleta, ['#0b0b10', '#7c5cff', '#ffffff']);
});

test('extrairJson aceita bloco cercado e texto com lixo em volta', () => {
  assert.deepEqual(extrairJson('Aqui está:\n```json\n{"a":1}\n```\nfim'), { a: 1 });
  assert.deepEqual(extrairJson('blá {"a":{"b":2}} blá'), { a: { b: 2 } });
  assert.throws(() => extrairJson('nada aqui'));
});

test('I7: ids viram seguros para caminho de arquivo', () => {
  const { plano: p } = validarPlano(plano({ elementos: [el('../../x', 1, 2), el('título 3', 2, 3)] }), { duracao: 10 });
  for (const e of p.elementos) assert.match(e.id, /^[\w-]+$/);
});
