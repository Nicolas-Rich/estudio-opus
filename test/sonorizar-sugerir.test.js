import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAPEIS, papelDoEvento, papelEnfase } from '../lib/sonorizar/papeis.js';
import { montarKit, sugerirClipes } from '../lib/sonorizar/sugerir.js';

const ev = (t, tipo, extra = {}) => ({ t, tipo, x: 0.5, y: 0.5, area: 0.005, grupo: 0, dir: 0, digitacao: false, ...extra });
const som = (id, categoria, extra = {}) => ({ id, categoria, duracao: 0.2, macio: 0.5, pai: null, arquivo: `${id}.wav`, nome: id, ...extra });

test('papel de cada evento', () => {
  assert.equal(papelDoEvento(ev(1, 'entra', { digitacao: true })), 'digitacao');
  assert.equal(papelDoEvento(ev(1, 'entra', { area: 0.02 })), 'item-grande');
  assert.equal(papelDoEvento(ev(1, 'entra', { area: 0.019 })), 'item-pequeno');
  assert.equal(papelDoEvento(ev(1, 'sai')), 'saida');
  assert.equal(papelDoEvento(ev(1, 'move')), 'movimento');
  assert.equal(papelDoEvento(ev(1, 'corte')), 'corte');
  assert.equal(papelDoEvento(ev(1, 'outro')), null);
  assert.deepEqual(PAPEIS['item-pequeno'], { categorias: ['clique', 'ui', 'tique'], duracaoMax: 0.6, volume: 0.7 });
  assert.deepEqual(papelEnfase('brilho'), { categorias: ['brilho'], duracaoMax: 3, volume: 0.9 });
});

test('kit: favorito > macio > fatia; respeita duração; não repete o arquivo; até 3', () => {
  const sons = [
    som('fatia', 'clique', { pai: 'p0', arquivo: 'p0.wav', macio: 0.2 }),
    som('macio', 'clique', { macio: 0.9 }),
    som('fav', 'clique', { macio: 0 }),
    som('longo', 'clique', { duracao: 0.9, macio: 1 }),
    som('irma1', 'clique', { pai: 'p1', arquivo: 'p1.wav', macio: 0.3 }),
    som('irma2', 'clique', { pai: 'p1', arquivo: 'p1.wav', macio: 0.3 }),
  ];
  const { kit } = montarKit(sons, { favoritos: new Set(['fav']), papeis: ['item-pequeno'] });
  const ids = kit['item-pequeno'].map((s) => s.id);
  assert.equal(ids.length, 3);
  assert.equal(ids[0], 'fav');
  assert.equal(ids[1], 'macio');
  assert.ok(!ids.includes('longo'));
  assert.ok(!(ids.includes('irma1') && ids.includes('irma2')));
});

test('kit: categoria ausente vira aviso pelo rótulo', () => {
  const { kit, faltando } = montarKit([som('a', 'whoosh')], { papeis: ['digitacao', 'saida'] });
  assert.ok(faltando.includes('Teclado'));
  assert.equal(kit.saida.length, 1);
  assert.equal(kit.digitacao, undefined);
});

const kit3 = { 'item-pequeno': [som('A', 'clique'), som('B', 'clique'), som('C', 'clique')] };

test('sugestões: revezamento 1-2-3-1', () => {
  const c = sugerirClipes({ eventos: [ev(1, 'entra'), ev(1.5, 'entra'), ev(2, 'entra'), ev(2.5, 'entra')], kit: kit3, duracao: 10 });
  assert.deepEqual(c.map((x) => x.somId), ['A', 'B', 'C', 'A']);
  assert.ok(c.every((x) => x.uid && x.volume === 0.7 && x.papel === 'item-pequeno'));
});

test('sugestões: fusão < 60 ms com prioridade da ênfase', () => {
  const kit = { ...kit3, 'enfase:impacto': [som('I', 'impacto', { duracao: 1 })] };
  const c = sugerirClipes({ eventos: [ev(2.04, 'entra')], enfases: [{ t: 2, categoria: 'impacto' }], kit, duracao: 10 });
  assert.deepEqual(c.map((x) => x.somId), ['I']);
});

test('sugestões: densidade sutil ≤ 2 por segundo', () => {
  const eventos = Array.from({ length: 100 }, (_, k) => ev(k * 0.1, 'entra'));
  assert.ok(sugerirClipes({ eventos, kit: kit3, intensidade: 'sutil', duracao: 10 }).length <= 20);
});

test('sugestões: corte da análise perto de um corte do detector não duplica', () => {
  const kit = { corte: [som('W', 'whoosh')] };
  const c = sugerirClipes({ eventos: [ev(3, 'corte', { area: 1 })], cortes: [3.2, 6], kit, duracao: 10 });
  assert.deepEqual(c.map((x) => x.t), [3, 6]);
});

test('sugestões: riser termina na palavra', () => {
  const kit = { 'enfase:riser': [som('R', 'riser', { duracao: 2 })] };
  assert.equal(sugerirClipes({ enfases: [{ t: 5, categoria: 'riser' }], kit, duracao: 10 })[0].t, 3);
  assert.equal(sugerirClipes({ enfases: [{ t: 1, categoria: 'riser' }], kit, duracao: 10 })[0].t, 0);
});

test('sugestões: papel sem kit não gera clipe; nada detectado → []', () => {
  assert.deepEqual(sugerirClipes({ eventos: [ev(1, 'sai')], kit: kit3, duracao: 10 }), []);
  assert.deepEqual(sugerirClipes({ kit: kit3, duracao: 10 }), []);
});
