import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarPedidoDoVideo } from '../lib/assistente.js';

const transcricao = {
  duracao: 12.4,
  frases: [{ inicio: 0.2, fim: 2.1, texto: 'Para de pagar editor de vídeo' }, { inicio: 2.5, fim: 4.8, texto: 'a IA cria tudo pra mim' }],
  palavras: [{ p: 'Para', inicio: 0.2, fim: 0.4 }, { p: 'IA', inicio: 3.0, fim: 3.2 }],
};
const base = { transcricao, folhas: ['folha-01.png', 'folha-02.png'], largura: 1080, altura: 1920, duracao: 12.4 };

test('o pedido traz a fala com os tempos e manda ler as folhas de quadros', () => {
  const p = montarPedidoDoVideo(base);
  assert.match(p, /0\.20[–-]2\.10.*Para de pagar editor de vídeo/);
  assert.match(p, /folha-01\.png, folha-02\.png/);
  assert.match(p, /1080×1920/);
  assert.match(p, /12\.4/);
});

test('o prompt pedido é de animação POR CIMA do vídeo, construída sobre o que a pessoa fala', () => {
  const p = montarPedidoDoVideo(base);
  assert.match(p, /por cima/i);
  assert.match(p, /transparente/i);
  assert.match(p, /rosto/i);
});

test('a ideia da pessoa entra como complemento quando existe', () => {
  assert.match(montarPedidoDoVideo({ ...base, ideia: 'estilo roxo neon' }), /estilo roxo neon/);
  assert.doesNotMatch(montarPedidoDoVideo(base), /Observações da pessoa/);
});
