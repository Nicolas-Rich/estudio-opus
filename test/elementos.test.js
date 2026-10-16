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
  assert.doesNotMatch(p, /\d\.\d\d ontem/); // fora da lista com tempos (pode aparecer só na frase de contexto)
  assert.match(p, /O que a pessoa está dizendo neste momento: "ontem bola"/);
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

test('com furo, o pedido avisa onde a pessoa aparece', () => {
  const furo = [{ t: 0, x: 43, y: 1075, w: 432, h: 768 }, { t: 1, x: 43, y: 1075, w: 432, h: 768 }];
  const p = montarPedidoElemento({ el: { id: 'e4', inicio: 0, fim: 1, camada: 'tela-cheia', descricao: 'x' }, estilo, palavras: [], furo });
  assert.match(p, /x 43, y 1075, 432×768/);
});

test('ehLimiteClaude reconhece o aviso de limite e ignora outros erros', () => {
  assert.equal(ehLimiteClaude(new Error("You've hit your weekly limit · resets Oct 17, 5pm")), true);
  assert.equal(ehLimiteClaude(new Error('Claude usage limit reached')), true);
  assert.equal(ehLimiteClaude(new Error('ffmpeg: erro')), false);
});

test('I1: erro de resposta cortada pelo "limite de tokens" NÃO é limite de uso', () => {
  assert.equal(ehLimiteClaude(new Error('A resposta do Claude veio sem o começo do HTML (provavelmente cortada pelo limite de tokens).')), false);
  assert.equal(ehLimiteClaude(new Error('Limite de saída atingido — o Claude está continuando')), false);
});

test('I3: render que falha não estraga o render.mov que já existia', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { renderizarElemento } = await import('../lib/edicao-ia/elementos.js');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'eia-i3-'));
  const dir = path.join(pasta, 'elementos', 'e1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'render.mov'), 'BOM');
  const render = async (o) => { fs.writeFileSync(o.saida, 'PELA-METADE'); throw new Error('Render cancelado'); };
  await assert.rejects(renderizarElemento({ el: { id: 'e1', inicio: 0, fim: 1, camada: 'tela-cheia' }, pasta, url: 'x', render }));
  assert.equal(fs.readFileSync(path.join(dir, 'render.mov'), 'utf8'), 'BOM');
});

test('estilo: pedido do elemento leva o sistema visual do estilo', async () => {
  const { estiloPorId } = await import('../lib/edicao-ia/estilos.js');
  const base = { id: 'e1', inicio: 0, fim: 1, camada: 'sobre', regiao: { x: 0, y: 0, w: 50, h: 50 }, descricao: 'x' };
  const comEstilo = montarPedidoElemento({ el: base, estilo, palavras: [], estiloEdicao: 'criador-tech' });
  assert.ok(comEstilo.includes(estiloPorId('criador-tech').regrasElemento.slice(0, 60)));
  assert.doesNotMatch(montarPedidoElemento({ el: base, estilo, palavras: [], estiloEdicao: 'livre' }), /SISTEMA VISUAL/);
});
