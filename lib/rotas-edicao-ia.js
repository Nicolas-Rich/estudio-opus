// Aba "Edição IA": a pessoa envia os vídeos dela falando; o estúdio emenda, corta, planeja, cria elementos e monta no Editor.
import { createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sondar } from './ffmpeg.js';
import { prepararEdicao } from './edicao-ia/preparar.js';
import { pedirPlano, validarPlano } from './edicao-ia/plano.js';
import { gerarElemento, ehLimiteClaude } from './edicao-ia/elementos.js';
import { montarEdicao, furoDaPessoa } from './edicao-ia/montar.js';
import { recuperarEstado, extensaoDeVideo, proximoElemento, nomeMidiaBase, deveMontarAutomatico } from './edicao-ia/estado.js';
import { ESTILOS_EDICAO, ESTILO_PADRAO } from './edicao-ia/estilos.js';

const MODELO_PADRAO = 'claude-opus-5-5';
const idValido = (id) => /^eia[a-z0-9]+$/.test(String(id || ''));
const estiloDe = (e) => (ESTILOS_EDICAO[e?.estiloEdicao] ? e.estiloEdicao : ESTILO_PADRAO);
const nomeSeguro = (n) => path.basename(String(n || '')).replace(/[^\w.\- ]+/g, '_').slice(0, 120);

export function registrarRotasEdicaoIa(app, ctx) {
  const { DADOS, PASTAS, BASE, criarJob, msgJob, jobPublico, lerJson, gravarJson, registrarMidia } = ctx;
  const RAIZ = path.join(DADOS, 'edicoes-ia');
  const pastaDe = (id) => path.join(RAIZ, id);
  const arqEstado = (id) => path.join(pastaDe(id), 'estado.json');
  const lerEstado = (id) => (idValido(id) ? lerJson(arqEstado(id), null) : Promise.resolve(null));

  // gravações do estado de cada edição, uma de cada vez
  const filas = new Map();
  const alterar = (id, fn) => {
    const p = (filas.get(id) || Promise.resolve()).then(async () => {
      const e = await lerJson(arqEstado(id), null);
      if (!e) throw new Error('Edição não encontrada.');
      fn(e);
      e.atualizado = Date.now();
      await gravarJson(arqEstado(id), e);
      return e;
    });
    filas.set(id, p.catch(() => {}));
    return p;
  };
  const lerPlano = (id) => lerJson(path.join(pastaDe(id), 'plano.json'), null);
  const lerPrep = (id) => lerJson(path.join(pastaDe(id), 'prep.json'), null);

  // ao abrir o estúdio: nada está rodando
  (async () => {
    for (const id of await fs.readdir(RAIZ).catch(() => [])) {
      if (!idValido(id)) continue;
      const e = await lerJson(arqEstado(id), null);
      if (e) await gravarJson(arqEstado(id), recuperarEstado(e));
    }
  })().catch(() => {});

  const comEstado = (fn) => async (req, res) => {
    try {
      const e = await lerEstado(req.params.id);
      if (!e) return res.status(404).json({ erro: 'Edição não encontrada.' });
      await fn(req, res, e);
    } catch (err) { res.status(400).json({ erro: err.message }); }
  };

  app.get('/api/edicao-ia/estilos', (_req, res) => res.json(Object.values(ESTILOS_EDICAO).map(({ id, nome, descricao }) => ({ id, nome, descricao }))));

  // ------------------------------------------------------------ lista, criar, abrir, apagar
  app.get('/api/edicao-ia', async (_req, res) => {
    const lista = [];
    for (const id of await fs.readdir(RAIZ).catch(() => [])) {
      const e = idValido(id) && (await lerJson(arqEstado(id), null));
      if (e) lista.push(e);
    }
    res.json(lista.sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0)));
  });
  app.post('/api/edicao-ia', async (req, res) => {
    const id = `eia${Date.now().toString(36)}`;
    await fs.mkdir(path.join(pastaDe(id), 'videos'), { recursive: true });
    const e = { id, nome: String(req.body?.nome || 'Minha edição').slice(0, 80), briefing: '', estiloEdicao: ESTILO_PADRAO, automatico: false, ordem: [], etapa: 'enviado', erro: null, elementos: {}, avisos: [], custo: 0, criado: Date.now(), atualizado: Date.now() };
    await gravarJson(arqEstado(id), e);
    res.json(e);
  });
  app.get('/api/edicao-ia/:id', comEstado(async (req, res, e) => {
    const [plano, prep, transcricao] = await Promise.all([lerPlano(e.id), lerPrep(e.id), lerJson(path.join(pastaDe(e.id), 'transcricao.json'), null)]);
    res.json({ estado: e, plano, duracao: prep?.duracao || null, segmentos: prep?.segmentos || [], transcricao });
  }));
  app.delete('/api/edicao-ia/:id', comEstado(async (_req, res, e) => {
    await fs.rm(pastaDe(e.id), { recursive: true, force: true });
    res.json({ ok: true });
  }));
  app.put('/api/edicao-ia/:id', comEstado(async (req, res, e) => {
    const b = req.body || {};
    if (Array.isArray(b.ordem)) {
      const atuais = [...e.ordem].sort().join('|');
      if ([...b.ordem].sort().join('|') !== atuais) throw new Error('A ordem precisa ter os mesmos vídeos enviados.');
    }
    res.json(await alterar(e.id, (x) => {
      if (Array.isArray(b.ordem)) x.ordem = b.ordem;
      if (typeof b.briefing === 'string') x.briefing = b.briefing.slice(0, 4000);
      if (typeof b.automatico === 'boolean') x.automatico = b.automatico;
      if (ESTILOS_EDICAO[b.estiloEdicao]) x.estiloEdicao = b.estiloEdicao;
      if (typeof b.nome === 'string' && b.nome.trim()) x.nome = b.nome.trim().slice(0, 80);
    }));
  }));

  // ------------------------------------------------------------ vídeos enviados
  app.post('/api/edicao-ia/:id/videos', comEstado(async (req, res, e) => {
    const original = nomeSeguro(req.query.nome || 'video.mp4');
    if (!extensaoDeVideo(original)) throw new Error('Envie um arquivo de vídeo (MP4, MOV, M4V, WEBM ou MKV).');
    const dir = path.join(pastaDe(e.id), 'videos');
    await fs.mkdir(dir, { recursive: true });
    const nome = `${Date.now().toString(36)}-${original}`;
    const arq = path.join(dir, nome);
    await new Promise((ok, falha) => { const ws = createWriteStream(arq); req.pipe(ws); ws.on('finish', ok); ws.on('error', falha); });
    const info = await sondar(arq);
    if (!info.largura || !info.duracao) {
      await fs.rm(arq, { force: true });
      throw new Error('Envie um arquivo de vídeo.');
    }
    await alterar(e.id, (x) => { x.ordem.push(nome); x.etapa = 'enviado'; });
    res.json({ nome, duracao: info.duracao, largura: info.largura, altura: info.altura, temAudio: info.temAudio });
  }));
  app.delete('/api/edicao-ia/:id/videos/:nome', comEstado(async (req, res, e) => {
    const nome = path.basename(req.params.nome);
    await fs.rm(path.join(pastaDe(e.id), 'videos', nome), { force: true });
    res.json(await alterar(e.id, (x) => { x.ordem = x.ordem.filter((n) => n !== nome); }));
  }));
  app.get('/edicao-ia/:id/videos/:nome', (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).end();
    const arq = path.join(pastaDe(req.params.id), 'videos', path.basename(req.params.nome));
    if (!existsSync(arq)) return res.status(404).end();
    res.sendFile(arq);
  });

  // ------------------------------------------------------------ preparar → planejar (→ gerar → montar, no automático)
  async function planejar(id, job, instrucao = '') {
    const e = await lerEstado(id);
    const prep = await lerPrep(id);
    const transcricao = await lerJson(path.join(pastaDe(id), 'transcricao.json'), null);
    if (!prep || !transcricao) throw new Error('Prepare os vídeos primeiro.');
    await alterar(id, (x) => { x.etapa = 'planejando'; x.erro = null; });
    msgJob(job, 'O Claude está assistindo e planejando a edição…');
    const briefing = [e.briefing, instrucao && `NOVO PEDIDO PARA ESTE PLANO: ${instrucao}`].filter(Boolean).join('\n\n');
    const r = await pedirPlano({
      transcricao, candidatos: prep.candidatos, segmentos: prep.segmentos, duracao: prep.duracao, briefing,
      folhas: prep.folhas, estiloEdicao: estiloDe(e), pastaQuadros: path.join(pastaDe(id), 'quadros'), modelo: e.modelo || MODELO_PADRAO,
      sinal: job.controle.signal, aoProgresso: (chars, msg) => { if (msg) msgJob(job, msg); else if (chars) job.ultima = `Planejando… ${(chars / 1000).toFixed(1)}k caracteres`; },
    });
    await gravarJson(path.join(pastaDe(id), 'plano.json'), r.plano);
    await fs.rm(path.join(pastaDe(id), 'elementos'), { recursive: true, force: true });
    await alterar(id, (x) => {
      x.etapa = 'planejado'; x.avisos = r.avisos; x.custo = (x.custo || 0) + r.custo;
      x.elementos = Object.fromEntries(r.plano.elementos.map((el) => [el.id, { status: 'pendente' }]));
    });
    msgJob(job, `Plano pronto: ${r.plano.elementos.length} elementos, ${r.plano.movimentos.length} movimentos.`);
  }

  const iniciarJob = (res, id, rotulo, fn) => {
    const job = criarJob('edicao-ia', { rotulo, edicaoId: id });
    job.status = 'rodando';
    res.json({ job: jobPublico(job) });
    fn(job).then(() => { job.status = 'ok'; job.progresso = 1; }).catch(async (err) => {
      job.status = 'erro';
      job.erro = err.message;
      msgJob(job, 'Erro: ' + err.message);
      await alterar(id, (x) => { x.etapa = 'erro'; x.erro = err.message; }).catch(() => {});
    });
    return job;
  };

  app.post('/api/edicao-ia/:id/preparar', comEstado(async (_req, res, e) => {
    if (!e.ordem.length) throw new Error('Envie pelo menos um vídeo.');
    iniciarJob(res, e.id, 'Preparando a Edição IA', async (job) => {
      await alterar(e.id, (x) => { x.etapa = 'preparando'; x.erro = null; });
      const pasta = pastaDe(e.id);
      const r = await prepararEdicao({
        pasta, fontes: e.ordem.map((n) => path.join(pasta, 'videos', n)), sinal: job.controle.signal,
        progresso: (p, m) => { job.progresso = p * 0.5; if (m) msgJob(job, m); },
      });
      if (!r.transcricao.palavras.length) throw new Error('Não encontrei fala no vídeo.');
      await gravarJson(path.join(pasta, 'prep.json'), { versao: Date.now().toString(36), duracao: r.duracao, segmentos: r.segmentos, folhas: r.folhas, candidatos: r.candidatos });
      await alterar(e.id, (x) => { x.etapa = 'preparado'; });
      await planejar(e.id, job);
      if ((await lerEstado(e.id)).automatico) {
        await enfileirarTodos(e.id);
        await rodarFila(e.id, job);
        // monta uma vez, no fim, e só com tudo pronto (na pausa por limite, espera o Continuar + Montar)
        if (deveMontarAutomatico(await lerEstado(e.id))) {
          await montar(e.id);
          msgJob(job, 'Edição montada no Editor.');
        } else msgJob(job, 'Elementos pausados: clique em Continuar e depois em Montar no Editor.');
      }
    });
  }));

  app.post('/api/edicao-ia/:id/planejar', comEstado(async (req, res, e) => {
    iniciarJob(res, e.id, 'Refazendo o plano', (job) => planejar(e.id, job, String(req.body?.instrucao || '').slice(0, 2000)));
  }));

  app.put('/api/edicao-ia/:id/plano', comEstado(async (req, res, e) => {
    const prep = await lerPrep(e.id);
    if (!prep) throw new Error('Prepare os vídeos primeiro.');
    const antigo = (await lerPlano(e.id)) || { elementos: [] };
    const { plano, avisos } = validarPlano(req.body, { duracao: prep.duracao, estiloEdicao: estiloDe(e) });
    await gravarJson(path.join(pastaDe(e.id), 'plano.json'), plano);
    // elemento cujo pedido mudou precisa ser gerado de novo
    const chave = (el) => JSON.stringify([el.inicio, el.fim, el.camada, el.regiao, el.descricao, el.textoNaTela]);
    const antes = new Map(antigo.elementos.map((el) => [el.id, chave(el)]));
    const estado = await alterar(e.id, (x) => {
      x.avisos = avisos;
      x.elementos = Object.fromEntries(plano.elementos.map((el) => {
        const atual = x.elementos[el.id];
        return [el.id, atual && antes.get(el.id) === chave(el) ? atual : { status: 'pendente' }];
      }));
    });
    res.json({ plano, avisos, estado });
  }));

  // ------------------------------------------------------------ fila de elementos
  const rodando = new Set();
  async function enfileirarTodos(id) {
    await alterar(id, (x) => {
      for (const [elId, el] of Object.entries(x.elementos)) if (el.status !== 'pronto') x.elementos[elId] = { ...el, status: 'fila', erro: null };
      x.etapa = 'gerando'; x.erro = null;
    });
  }

  async function rodarFila(id, job) {
    if (rodando.has(id)) return;
    rodando.add(id);
    try {
      const pasta = pastaDe(id);
      const transcricao = await lerJson(path.join(pasta, 'transcricao.json'), { palavras: [] });
      for (;;) {
        const [e, plano] = await Promise.all([lerEstado(id), lerPlano(id)]);
        const elId = proximoElemento(plano, e.elementos);
        if (!elId) {
          await alterar(id, (x) => { if (x.etapa === 'gerando') x.etapa = 'pronto'; });
          return;
        }
        const el = plano.elementos.find((x) => x.id === elId);
        const instrucao = e.elementos[elId].instrucao || '';
        await alterar(id, (x) => { x.elementos[elId] = { ...x.elementos[elId], status: 'gerando', erro: null }; });
        const n = plano.elementos.findIndex((x) => x.id === elId) + 1;
        msgJob(job, `Criando o elemento ${n} de ${plano.elementos.length}…`);
        try {
          const r = await gerarElemento({
            el, estilo: plano.estilo, palavras: transcricao.palavras, pasta, instrucao, estiloEdicao: estiloDe(e), furo: furoDaPessoa(plano.movimentos, el),
            urlDe: (v) => `${BASE}/edicao-ia/${id}/elementos/${encodeURIComponent(el.id)}/v${v}.html`,
            modelo: e.modelo || MODELO_PADRAO, sinal: job.controle.signal,
            aoProgresso: (_c, m) => { if (m) job.ultima = `Elemento ${n}: ${m}`; },
          });
          await alterar(id, (x) => {
            x.elementos[elId] = { status: 'pronto', versao: r.versao, custo: r.custo };
            x.custo = (x.custo || 0) + r.custo;
          });
        } catch (err) {
          if (ehLimiteClaude(err)) {
            await alterar(id, (x) => {
              x.elementos[elId] = { ...x.elementos[elId], status: 'fila' };
              x.etapa = 'pausado';
              x.erro = 'Limite do Claude atingido — clique em Continuar quando ele voltar.';
            });
            return;
          }
          if (job.controle.signal.aborted) throw err;
          await alterar(id, (x) => { x.elementos[elId] = { ...x.elementos[elId], status: 'erro', erro: err.message }; });
        }
      }
    } finally {
      rodando.delete(id);
    }
  }

  const iniciarFila = (res, e, rotulo) => iniciarJob(res, e.id, rotulo, (job) => rodarFila(e.id, job));

  app.post('/api/edicao-ia/:id/gerar', comEstado(async (_req, res, e) => {
    if (!(await lerPlano(e.id))) throw new Error('Ainda não há plano.');
    if (rodando.has(e.id)) throw new Error('Os elementos já estão sendo gerados.');
    await enfileirarTodos(e.id);
    iniciarFila(res, e, 'Criando os elementos');
  }));
  app.post('/api/edicao-ia/:id/continuar', comEstado(async (_req, res, e) => {
    if (rodando.has(e.id)) throw new Error('Os elementos já estão sendo gerados.');
    await enfileirarTodos(e.id);
    iniciarFila(res, e, 'Continuando os elementos');
  }));
  app.post('/api/edicao-ia/:id/elementos/:elId/refazer', comEstado(async (req, res, e) => {
    const elId = String(req.params.elId);
    if (!e.elementos[elId]) throw new Error('Elemento não encontrado.');
    const instrucao = String(req.body?.instrucao || '').slice(0, 2000);
    await alterar(e.id, (x) => { x.elementos[elId] = { ...x.elementos[elId], status: 'fila', erro: null, instrucao }; if (x.etapa !== 'gerando') x.etapa = 'gerando'; });
    if (rodando.has(e.id)) return res.json({ ok: true, naFila: true });
    iniciarFila(res, e, 'Refazendo um elemento');
  }));

  // ------------------------------------------------------------ montar no Editor
  async function montar(id) {
    const e = await lerEstado(id);
    const pasta = pastaDe(id);
    const [plano, transcricao] = await Promise.all([lerPlano(id), lerJson(path.join(pasta, 'transcricao.json'), { palavras: [] })]);
    if (!plano) throw new Error('Ainda não há plano.');
    const prep = await lerPrep(id);
    const nomeMidia = nomeMidiaBase(id, prep?.versao || 'v1');
    const destino = path.join(PASTAS.midia, nomeMidia);
    if (!existsSync(destino)) await fs.copyFile(path.join(pasta, 'base.mp4'), destino);
    await registrarMidia(destino, { origem: 'edicao-ia', titulo: `${e.nome} (base)` });
    const arqEdicao = path.join(DADOS, 'edicao.json');
    if (existsSync(arqEdicao)) {
      const d = new Date();
      const p2 = (x) => String(x).padStart(2, '0');
      await fs.copyFile(arqEdicao, path.join(DADOS, `edicao-anterior-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`));
    }
    const prontos = Object.entries(e.elementos).filter(([, x]) => x.status === 'pronto').map(([elId, x]) => ({ elId, versao: x.versao }));
    const edicao = montarEdicao({ plano, midiaBase: nomeMidia, edicaoId: id, elementosProntos: prontos, palavras: transcricao.palavras, nome: e.nome, estiloEdicao: estiloDe(e) });
    await gravarJson(arqEdicao, edicao);
    await alterar(id, (x) => { x.montado = Date.now(); });
    return { elementos: prontos.length, total: plano.elementos.length };
  }
  app.post('/api/edicao-ia/:id/montar', comEstado(async (_req, res, e) => {
    res.json(await montar(e.id));
  }));

  // ------------------------------------------------------------ arquivos dos elementos (render e prévia)
  const arqElemento = (req, nome) => {
    if (!idValido(req.params.id) || !/^[\w-]+$/.test(req.params.elId)) return null;
    const arq = path.join(pastaDe(req.params.id), 'elementos', req.params.elId, nome);
    return existsSync(arq) ? arq : null;
  };
  app.get('/edicao-ia/:id/elementos/:elId/v:n.html', (req, res) => {
    const arq = /^\d+$/.test(req.params.n) && arqElemento(req, `v${req.params.n}.html`);
    if (!arq) return res.status(404).end();
    res.set('Cache-Control', 'no-store').sendFile(arq);
  });
  app.get('/edicao-ia/:id/elementos/:elId/preview.webm', (req, res) => {
    const arq = arqElemento(req, 'preview.webm');
    if (!arq) return res.status(404).end();
    res.set('Cache-Control', 'no-store').sendFile(arq);
  });
}
