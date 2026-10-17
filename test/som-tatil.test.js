import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehTatil, textoDoPedidoSfx, cadeiaTatil, variacao } from '../lib/som-tatil.js';

test('cliques, teclas, caneta e papel são táteis; impactos e whooshes não', () => {
  assert.ok(ehTatil('ui', 'soft frosted glass panel slide-up'));
  assert.ok(ehTatil('foley', 'marker pen strike across paper'));
  assert.ok(ehTatil('hit', 'soft warm typographic tap hit'));
  assert.ok(ehTatil('textura', 'rapid mechanical keyboard typing burst'));
  assert.ok(ehTatil('glitch', 'tiny metallic clicks'));
  assert.ok(!ehTatil('impacto', 'premium cinematic reveal impact, deep sub boom'));
  assert.ok(!ehTatil('whoosh', 'fast airy whoosh passing left to right'));
  assert.ok(!ehTatil('stinger', 'elegant sonic logo stinger'));
  assert.ok(!ehTatil('ambiente', 'quiet room tone with soft clicks'));
});

test('pedido de som tátil é ASMR (sem "cinematic") e mais fiel ao texto', () => {
  const p = textoDoPedidoSfx({ descricao: 'single soft keyboard key press.', categoria: 'ui' });
  assert.match(p.texto, /^single soft keyboard key press\. /);
  assert.match(p.texto, /ASMR/);
  assert.match(p.texto, /close-mic/);
  assert.doesNotMatch(p.texto, /cinematic/i);
  assert.equal(p.influencia, 0.7);
});

test('pedido dos outros sons continua cinematográfico', () => {
  const p = textoDoPedidoSfx({ descricao: 'deep sub boom', categoria: 'boom', dica: 'huge and round' });
  assert.match(p.texto, /cinematic sound design/);
  assert.doesNotMatch(p.texto, /ASMR/);
  assert.equal(p.influencia, 0.55);
  assert.equal(textoDoPedidoSfx({ descricao: 'room', categoria: 'ambiente', loop: true }).influencia, 0.4);
});

test('cadeia tátil tira a aspereza, aquece, dá ar e evita estalos nas pontas', () => {
  const c = cadeiaTatil();
  assert.match(c, /equalizer=f=3200:[^,]*g=-3/);
  assert.match(c, /equalizer=f=250:[^,]*g=1\.5/);
  assert.match(c, /deesser/);
  assert.match(c, /highshelf=f=10000:g=2/);
  assert.match(c, /afade=t=in/);
  assert.doesNotMatch(c, /equalizer=f=4200/);
});

test('repetições do mesmo som variam um pouco (tom ±3%, volume ±1,5 dB); a primeira fica igual', () => {
  assert.deepEqual(variacao(0), { tom: 1, ganhoDb: 0 });
  const vs = [1, 2, 3, 4, 5, 6, 7, 8].map(variacao);
  for (const v of vs) {
    assert.ok(v.tom >= 0.97 && v.tom <= 1.03, `tom ${v.tom}`);
    assert.ok(Math.abs(v.ganhoDb) <= 1.5, `ganho ${v.ganhoDb}`);
  }
  assert.ok(new Set(vs.map((v) => v.tom)).size >= 6, 'repetições precisam soar diferentes');
  assert.deepEqual(variacao(3), variacao(3), 'determinístico (o render sai sempre igual)');
});
