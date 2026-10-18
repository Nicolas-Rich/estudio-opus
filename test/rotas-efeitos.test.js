import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gravarWav } from '../lib/faixa-itens.js';
import { indexarPacote, gravarCatalogo } from '../lib/biblioteca/catalogo.js';
import { registrarRotasEfeitos } from '../lib/rotas-efeitos.js';

const SR = 48000;
const lerJson = async (a, pad) => { try { return JSON.parse(await fs.readFile(a, 'utf8')); } catch { return pad; } };
const gravarJson = (a, v) => fs.writeFile(a, JSON.stringify(v));

test('ouvir: arquivo inteiro e golpe (fatia recortada no cache) respondem com áudio', { timeout: 60_000 }, async () => {
  const DADOS = await fs.mkdtemp(path.join(os.tmpdir(), 'rotas-efx-'));
  const raiz = path.join(DADOS, 'biblioteca-sfx');
  const pasta = path.join(raiz, 'pac');
  await fs.mkdir(pasta, { recursive: true });
  const x = new Float32Array(1.4 * SR);
  for (const t of [0.2, 0.6, 1.0]) for (let i = 0; i < 240; i++) x[Math.round(t * SR) + i] = Math.sin(i * 1.3) * 0.8;
  await gravarWav([x, Float32Array.from(x)], path.join(pasta, 'Typewriter keys x3.wav'));
  const r = await indexarPacote({ raiz, pasta, pacote: 'pac' });
  await gravarCatalogo(raiz, { versao: 1, pacotes: [{ id: 'pac' }], sons: r.sons });
  const app = express();
  app.use(express.json());
  registrarRotasEfeitos(app, { DADOS, PASTAS: { sfx: raiz }, criarJob: () => ({}), msgJob: () => {}, jobPublico: (j) => j, lerJson, gravarJson });
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const inteiro = r.sons.find((s) => !s.pai);
    const golpe = r.sons.find((s) => s.pai);
    for (const s of [inteiro, golpe]) {
      const res = await fetch(`${base}/api/efeitos/ouvir/${s.id}`);
      assert.equal(res.status, 200, `${s.nome}: ${res.status}`);
      assert.match(res.headers.get('content-type'), /audio/);
    }
    assert.equal((await fetch(`${base}/api/efeitos/ouvir/naoexiste`)).status, 404);
  } finally {
    srv.close();
  }
});
