import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapaTempo, estadoDaImagem, montarEdicao } from '../lib/edicao-ia/montar.js';

const estilo = { paleta: ['#101010', '#7c5cff', '#ffffff'], fonte: 'Inter', clima: '' };

test('mapaTempo converte tempo da base para o editado', () => {
  const m = mapaTempo([{ inicio: 1, fim: 3 }, { inicio: 5, fim: 6 }]);
  assert.equal(m.paraEditado(1), 0);
  assert.equal(m.paraEditado(2.5), 1.5);
  assert.equal(m.paraEditado(5.5), 2.5);
  assert.equal(m.paraEditado(4), null);
  assert.equal(m.total, 3);
});

test('estado da imagem: canto inferior-esquerdo com margem de 4 %', () => {
  const s = estadoDaImagem([{ inicio: 0, fim: 10, tipo: 'canto', canto: 'inferior-esquerdo', escala: 0.4 }], 5);
  assert.deepEqual(s, { escala: 0.4, x: 24, y: 76 });
});

test('estado da imagem: fora de movimento é normal e a entrada tem rampa de 0,35 s', () => {
  const movs = [{ inicio: 1, fim: 3, tipo: 'zoom', escala: 1.3 }];
  assert.deepEqual(estadoDaImagem(movs, 0.5), { escala: 1, x: 50, y: 50 });
  const meio = estadoDaImagem(movs, 1.175).escala;
  assert.ok(meio > 1 && meio < 1.3);
  assert.equal(estadoDaImagem(movs, 2).escala, 1.3);
});

test('cada trecho manter vira um clipe com a mídia base', () => {
  const ed = montarEdicao({ plano: { estilo, manter: [{ inicio: 0, fim: 4 }, { inicio: 4.5, fim: 8 }], movimentos: [], elementos: [] }, midiaBase: 'base.mp4', edicaoId: 'x', elementosProntos: [] });
  assert.deepEqual(ed.clipes.map((c) => [c.midia, c.inicio, c.fim]), [['base.mp4', 0, 4], ['base.mp4', 4.5, 8]]);
  assert.ok(ed.clipes.every((c) => !('movimento' in c)));
});

test('movimento que atravessa um corte é dividido entre os clipes', () => {
  const plano = { estilo, manter: [{ inicio: 0, fim: 4 }, { inicio: 4.5, fim: 8 }], elementos: [],
    movimentos: [{ inicio: 2, fim: 6, tipo: 'canto', canto: 'inferior-esquerdo', escala: 0.38 }] };
  const [c1, c2] = montarEdicao({ plano, midiaBase: 'b', edicaoId: 'x', elementosProntos: [] }).clipes;
  assert.equal(c1.movimento.at(-1).escala, 0.38);
  assert.equal(c2.movimento[0].escala, 0.38);
  assert.equal(c2.movimento[0].t, 0);
});

test('sobreposição em pixels e em tempo editado; só entram elementos prontos', () => {
  const plano = { estilo, manter: [{ inicio: 1, fim: 3 }, { inicio: 5, fim: 6 }], movimentos: [], elementos: [
    { id: 'e1', inicio: 5.5, fim: 6, camada: 'sobre', regiao: { x: 10, y: 10, w: 80, h: 20 } },
    { id: 'e2', inicio: 1, fim: 2, camada: 'tela-cheia', regiao: null },
  ] };
  const ed = montarEdicao({ plano, midiaBase: 'b', edicaoId: 'ed1', elementosProntos: [{ elId: 'e1', versao: 2 }] });
  assert.equal(ed.sobreposicoes.length, 1);
  const s = ed.sobreposicoes[0];
  assert.deepEqual({ inicio: s.inicio, fim: s.fim, x: s.x, y: s.y, w: s.w, h: s.h, edicaoId: s.edicaoId, elId: s.elId, versao: s.versao },
    { inicio: 2.5, fim: 3, x: 108, y: 192, w: 864, h: 384, edicaoId: 'ed1', elId: 'e1', versao: 2 });
});

test('tela-cheia ocupa 1080x1920', () => {
  const plano = { estilo, manter: [{ inicio: 0, fim: 4 }], movimentos: [], elementos: [{ id: 'e2', inicio: 1, fim: 2, camada: 'tela-cheia', regiao: null }] };
  const [s] = montarEdicao({ plano, midiaBase: 'b', edicaoId: 'x', elementosProntos: [{ elId: 'e2', versao: 1 }] }).sobreposicoes;
  assert.deepEqual([s.x, s.y, s.w, s.h], [0, 0, 1080, 1920]);
});

test('legendas ligadas com as palavras nos tempos editados; palavras cortadas saem', () => {
  const plano = { estilo, manter: [{ inicio: 1, fim: 3 }, { inicio: 5, fim: 6 }], movimentos: [], elementos: [] };
  const palavras = [{ p: 'oi', inicio: 1.2, fim: 1.5 }, { p: 'éé', inicio: 3.5, fim: 4 }, { p: 'tchau', inicio: 5.1, fim: 5.6 }];
  const ed = montarEdicao({ plano, midiaBase: 'b', edicaoId: 'x', elementosProntos: [], palavras });
  assert.equal(ed.legendas.ativo, true);
  assert.deepEqual(ed.legendas.palavras.map((w) => [w.p, w.inicio]), [['oi', 0.2], ['tchau', 2.1]]);
  assert.ok(ed.legendas.itens.length >= 1);
});
