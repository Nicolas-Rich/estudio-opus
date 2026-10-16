import { test } from 'node:test';
import assert from 'node:assert/strict';
import { palcoDoElemento, montarPedidoElemento, ehLimiteClaude } from '../lib/edicao-ia/elementos.js';

const estilo = { paleta: ['#000000', '#7c5cff', '#ffffff'], fonte: 'Inter', clima: 'escuro' };

test('palco de "sobre" usa a regiao em pixels de 1080x1920', () => {
  assert.deepEqual(palcoDoElemento({ camada: 'sobre', regiao: { x: 0, y: 0, w: 50, h: 25 } }), { largura: 540, altura: 480 });
});

test('palco de tela cheia é 1080x1920', () => {
  assert.deepEqual(palcoDoElemento({ camada: 'tela-cheia', regiao: null }), { largura: 1080, altura: 1920 });
});

test('pedido traz a fala com tempos relativos ao início do elemento', () => {
  const p = montarPedidoElemento({ el: { id: 'e1', inicio: 10, fim: 12, camada: 'sobre', regiao: { x: 0, y: 0, w: 100, h: 20 }, descricao: 'x', textoNaTela: 'OI' },
    estilo, palavras: [{ p: 'ontem', inicio: 9, fim: 9.5 }, { p: 'bola', inicio: 10.5, fim: 10.9 }] });
  assert.match(p, /0\.50 bola/);
  assert.doesNotMatch(p, /ontem/);
  assert.match(p, /2\.00 s/);
});

test('fundo transparente só é exigido em "sobre"', () => {
  const base = { id: 'e1', inicio: 0, fim: 1, descricao: 'x', textoNaTela: '' };
  assert.match(montarPedidoElemento({ el: { ...base, camada: 'sobre', regiao: { x: 0, y: 0, w: 50, h: 50 } }, estilo, palavras: [] }), /transparent/i);
  assert.doesNotMatch(montarPedidoElemento({ el: { ...base, camada: 'tela-cheia', regiao: null }, estilo, palavras: [] }), /transparent/i);
});

test('instrução de refazer entra no pedido', () => {
  const p = montarPedidoElemento({ el: { id: 'e1', inicio: 0, fim: 1, camada: 'tela-cheia', descricao: 'x' }, estilo, palavras: [], instrucao: 'bola vermelha' });
  assert.match(p, /bola vermelha/);
});

test('ehLimiteClaude reconhece o aviso de limite e ignora outros erros', () => {
  assert.equal(ehLimiteClaude(new Error("You've hit your weekly limit · resets Oct 17, 5pm")), true);
  assert.equal(ehLimiteClaude(new Error('Claude usage limit reached')), true);
  assert.equal(ehLimiteClaude(new Error('ffmpeg: erro')), false);
});
