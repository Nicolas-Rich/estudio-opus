// Aba "Cenas IA (Kie.ai)": gera clipes realistas (Veo 3.1, Kling, Seedance, Grok) e manda para a Mídia do Editor.
import { createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { perguntarClaude } from './claude.js';
import {
  MODELOS_KIE, DOLAR_POR_CREDITO, saldoKie, enviarArquivoKie, montarTarefa, criarTarefaKie, consultarKie, baixar,
} from './kie.js';

const EXT_IMG = /\.(png|jpe?g|webp)$/i;

export function registrarRotasKie(app, ctx) {
  const { DADOS, PASTAS, criarJob, msgJob, jobPublico, lerJson, gravarJson, registrarMidia } = ctx;
  const ARQ_CONFIG = path.join(DADOS, 'config.json');
  const DIR = path.join(DADOS, 'kie');
  const DIR_IMG = path.join(DIR, 'imagens');
  const ARQ_HIST = path.join(DIR, 'historico.json');
  const chave = async () => (await lerJson(ARQ_CONFIG, {})).kieKey || '';
  const exigirChave = async () => { const k = await chave(); if (!k) throw new Error('Cole a sua chave do Kie.ai primeiro (campo no topo da aba).'); return k; };
  let fila = Promise.resolve(); // grava o histórico um de cada vez
  const alterarHist = (fn) => (fila = fila.then(async () => { await fs.mkdir(DIR, { recursive: true }); const h = await lerJson(ARQ_HIST, []); fn(h); await gravarJson(ARQ_HIST, h.slice(0, 200)); }));

  // gerações interrompidas por um reinício do estúdio não voltam: marca como erro com o id da tarefa
  alterarHist((h) => h.forEach((x) => {
    if (x.status !== 'gerando') return;
    x.status = 'erro';
    x.erro = `O estúdio foi fechado durante a geração.${x.taskId ? ` Se foi cobrado, o vídeo está em kie.ai → Logs (tarefa ${x.taskId}).` : ''}`;
  })).catch(() => {});

  app.get('/api/kie/modelos', (_req, res) => res.json(MODELOS_KIE));

  app.get('/api/kie/config', async (_req, res) => {
    const k = await chave();
    res.json({ configurado: !!k, final: k ? k.slice(-4) : null });
  });
  app.put('/api/kie/config', express.json(), async (req, res) => {
    const c = await lerJson(ARQ_CONFIG, {});
    const k = String(req.body?.chave || '').trim();
    if (!k) { delete c.kieKey; await gravarJson(ARQ_CONFIG, c); return res.json({ ok: true }); }
    try {
      const saldo = await saldoKie(k);
      c.kieKey = k;
      await gravarJson(ARQ_CONFIG, c);
      res.json({ ok: true, saldo });
    } catch (e) { res.status(400).json({ erro: e.message }); }
  });
  app.get('/api/kie/saldo', async (_req, res) => {
    try { const s = await saldoKie(await exigirChave()); res.json({ creditos: s, dolares: +(s * DOLAR_POR_CREDITO).toFixed(2) }); }
    catch (e) { res.status(400).json({ erro: e.message }); }
  });

  // imagens de referência (produto, pessoa, cenário) — corpo cru
  app.post('/api/kie/imagem', async (req, res) => {
    const original = path.basename(String(req.query.nome || 'imagem.png'));
    if (!EXT_IMG.test(original)) return res.status(400).json({ erro: 'Envie uma imagem PNG, JPG ou WEBP.' });
    await fs.mkdir(DIR_IMG, { recursive: true });
    const nome = `${Date.now()}-${original.replace(/[^\w.-]+/g, '_')}`;
    await new Promise((ok, falha) => { const ws = createWriteStream(path.join(DIR_IMG, nome)); req.pipe(ws); ws.on('finish', ok); ws.on('error', falha); });
    res.json({ nome, url: `/kie/imagens/${encodeURIComponent(nome)}` });
  });
  app.get('/kie/imagens/:nome', (req, res) => {
    const arq = path.join(DIR_IMG, path.basename(req.params.nome));
    if (!existsSync(arq)) return res.status(404).end();
    res.sendFile(arq);
  });

  app.get('/api/kie/historico', async (_req, res) => res.json(await lerJson(ARQ_HIST, [])));
  app.delete('/api/kie/historico/:id', async (req, res) => {
    await alterarHist((h) => { const i = h.findIndex((x) => x.id === req.params.id); if (i >= 0) h.splice(i, 1); });
    res.json({ ok: true });
  });

  // assistente: transforma a ideia em um prompt de vídeo forte (com fala em português, se pedir)
  app.post('/api/kie/prompt', express.json(), async (req, res) => {
    try {
      const { ideia, modelo, comFala, aspecto, duracao } = req.body || {};
      if (!String(ideia || '').trim()) return res.status(400).json({ erro: 'Escreva a ideia primeiro.' });
      const m = MODELOS_KIE.find((x) => x.id === modelo) || MODELOS_KIE[0];
      const pedido = [
        `Escreva UM prompt para o gerador de vídeo "${m.nome}" (clipe de ${duracao || m.duracoes[0]} s, formato ${aspecto || '9:16'}).`,
        `Ideia do usuário: ${ideia}`,
        '',
        'Regras:',
        '- Escreva o prompt em INGLÊS (os modelos entendem melhor), exceto as falas.',
        '- Descreva: sujeito (aparência, roupa, idade aproximada), ação, cenário, luz, enquadramento e movimento de câmera, estilo (ex.: UGC filmado no celular, selfie, handheld, luz natural).',
        comFala
          ? '- Inclua a FALA da pessoa em PORTUGUÊS DO BRASIL, entre aspas, no formato: The person says in Brazilian Portuguese: "…". Fala natural e curta (cabe no tempo do clipe, ~2,3 palavras por segundo), sotaque brasileiro.'
          : '- Sem fala.',
        '- Se houver produto nas imagens de referência, diga para mostrar o produto exatamente como na imagem (rótulo legível, mesma cor e formato).',
        '- Evite pedir textos escritos na tela (os modelos erram letras).',
        '- Uma cena só, contínua, sem cortes.',
        '',
        'Responda SOMENTE com o prompt, sem comentários.',
      ].join('\n');
      const r = await perguntarClaude({ sistema: 'Você é especialista em prompts para geradores de vídeo por IA (Veo, Kling, Seedance) e em anúncios UGC.', pedido, modelo: 'claude-sonnet-5-5', timeoutMs: 180_000 });
      res.json({ prompt: r.texto.replace(/^```\w*\s*|```\s*$/g, '').trim() });
    } catch (e) { res.status(400).json({ erro: e.message }); }
  });

  app.post('/api/kie/gerar', express.json(), async (req, res) => {
    let k;
    try { k = await exigirChave(); } catch (e) { return res.status(400).json({ erro: e.message }); }
    const b = req.body || {};
    const m = MODELOS_KIE.find((x) => x.id === b.modelo);
    if (!m) return res.status(400).json({ erro: 'Escolha um modelo.' });
    const prompt = String(b.prompt || '').trim();
    if (!prompt) return res.status(400).json({ erro: 'Escreva o prompt.' });
    const imagens = (b.imagens || []).map((n) => path.join(DIR_IMG, path.basename(n))).filter((a) => existsSync(a)).slice(0, m.maxImagens);
    const opcoes = {
      prompt, usoImagem: b.usoImagem || 'quadro', aspecto: m.aspectos.includes(b.aspecto) ? b.aspecto : m.aspectos[0],
      duracao: m.duracoes.includes(+b.duracao) ? +b.duracao : m.duracoes[0], resolucao: m.resolucoes.includes(b.resolucao) ? b.resolucao : m.resolucoes[0],
      audio: b.audio !== false,
    };
    const job = criarJob('kie', { rotulo: `Gerando no Kie.ai (${m.nome})` });
    const item = { id: job.id, modelo: m.id, modeloNome: m.nome, prompt, opcoes: { ...opcoes }, imagens: (b.imagens || []).slice(0, m.maxImagens), status: 'gerando', criado: Date.now() };
    await alterarHist((h) => h.unshift(item));
    job.status = 'rodando';
    res.json({ job: jobPublico(job) });

    const salvar = (mudar) => alterarHist((h) => { const x = h.find((y) => y.id === item.id); if (x) mudar(x); });
    try {
      const antes = await saldoKie(k).catch(() => null);
      if (imagens.length) msgJob(job, `Enviando ${imagens.length} imagem(ns)…`);
      opcoes.imagens = [];
      for (const a of imagens) opcoes.imagens.push(await enviarArquivoKie(k, a));
      const taskId = await criarTarefaKie(k, montarTarefa(m.id, opcoes));
      await salvar((x) => { x.taskId = taskId; });
      msgJob(job, 'Na fila do Kie.ai…');
      const t0 = Date.now();
      let r;
      for (;;) {
        if (job.controle.signal.aborted) throw new Error('Cancelado (a tarefa continua no Kie.ai e pode ser cobrada).');
        await new Promise((ok) => setTimeout(ok, 5000));
        r = await consultarKie(k, taskId).catch((e) => ({ estado: 'esperando', aviso: e.message }));
        const seg = Math.round((Date.now() - t0) / 1000);
        job.ultima = r.estado === 'gerando' ? `Gerando… ${seg}s (costuma levar 1 a 5 min)` : `Na fila do Kie.ai… ${seg}s`;
        job.progresso = Math.min(0.9, seg / 300);
        if (r.estado === 'pronto' || r.estado === 'falhou') break;
        if (Date.now() - t0 > 25 * 60_000) throw new Error('Passou de 25 min sem resposta. Veja a tarefa em kie.ai → Logs (id ' + taskId + ').');
      }
      if (r.estado === 'falhou') throw new Error('O Kie.ai recusou/falhou: ' + r.erro);
      if (!r.urls?.length) throw new Error('A tarefa terminou sem vídeo.');
      msgJob(job, 'Baixando o vídeo…');
      const base = `kie-${m.id.replace(/[^\w]+/g, '-')}-${Date.now()}`;
      const ext = (/\.(mp4|mov|webm|png|jpe?g)(\?|$)/i.exec(r.urls[0])?.[1] || 'mp4').toLowerCase();
      const saida = path.join(PASTAS.midia, `${base}.${ext}`);
      await baixar(r.urls[0], saida, job.controle.signal);
      const midia = await registrarMidia(saida, { origem: 'kie', modelo: m.nome, prompt: prompt.slice(0, 300) });
      const depois = await saldoKie(k).catch(() => null);
      const custo = antes != null && depois != null ? +(antes - depois).toFixed(2) : null;
      await salvar((x) => { x.status = 'pronto'; x.midia = midia.nome; x.duracao = midia.duracao; x.custoCreditos = custo; x.custoDolar = custo != null ? +(custo * DOLAR_POR_CREDITO).toFixed(3) : null; });
      job.resultado = { midia: midia.nome, custoCreditos: custo };
      job.status = 'ok';
      job.progresso = 1;
      msgJob(job, `Pronto! Está na Mídia do Editor.${custo != null ? ` Custou ${custo} créditos (US$ ${(custo * DOLAR_POR_CREDITO).toFixed(2)}).` : ''}`);
    } catch (e) {
      job.status = 'erro';
      job.erro = e.message;
      msgJob(job, 'Erro: ' + e.message);
      await salvar((x) => { x.status = 'erro'; x.erro = e.message; });
    }
  });
}
