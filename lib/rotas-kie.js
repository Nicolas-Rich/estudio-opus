// Aba "Cenas IA (Kie.ai)": gera clipes realistas (Veo 3.1, Kling, Seedance, Grok) e manda para a Mídia do Editor.
import { createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import { FFMPEG } from './ffmpeg.js';
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
      const { ideia, modelo, comFala, aspecto, duracao, perfilId, anterior } = req.body || {};
      const perfil = perfilId ? (await lerPerfis()).find((p) => p.id === perfilId) : null;
      if (!String(ideia || '').trim()) return res.status(400).json({ erro: 'Escreva a ideia primeiro.' });
      const m = MODELOS_KIE.find((x) => x.id === modelo) || MODELOS_KIE[0];
      const pedido = [
        `Escreva UM prompt para o gerador de vídeo "${m.nome}" (clipe de ${duracao || m.duracoes[0]} s, formato ${aspecto || '9:16'}).`,
        `Ideia do usuário: ${ideia}`,
        anterior ? `ESTE CLIPE CONTINUA o anterior, que começou do último quadro dele. Prompt do clipe anterior:
${anterior}
Continue a ação de forma natural a partir de onde parou (mesma pessoa, roupa, lugar, luz e câmera).` : '',
        perfil ? `MAPA FIXO (será anexado automaticamente ao prompt; não repita tudo, mas não contradiga nada):
${perfil.dna}` : '',
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

  // ---- mapas (personagem / produto / estilo): ficha fixa para todos os vídeos manterem as mesmas características
  const ARQ_PERFIS = path.join(DIR, 'perfis.json');
  const lerPerfis = () => lerJson(ARQ_PERFIS, []);
  const gravarPerfis = async (p) => { await fs.mkdir(DIR, { recursive: true }); await gravarJson(ARQ_PERFIS, p); };

  app.get('/api/kie/perfis', async (_req, res) => res.json(await lerPerfis()));

  // cria (ou refaz) o mapa: o Claude olha as fotos e escreve a descrição fixa em inglês
  app.post('/api/kie/perfis', express.json(), async (req, res) => {
    const b = req.body || {};
    const nome = String(b.nome || '').trim().slice(0, 60);
    if (!nome) return res.status(400).json({ erro: 'Dê um nome ao mapa.' });
    const imagens = (b.imagens || []).map((n) => path.basename(n)).filter((n) => existsSync(path.join(DIR_IMG, n))).slice(0, 4);
    const notas = String(b.notas || '').trim();
    if (!imagens.length && !notas) return res.status(400).json({ erro: 'Envie fotos ou descreva o personagem/produto.' });
    const pasta = path.join(PASTAS.temp, `mapa-${Date.now()}`);
    try {
      await fs.mkdir(pasta, { recursive: true });
      const locais = [];
      for (const [i, n] of imagens.entries()) {
        const dest = `ref-${i + 1}${path.extname(n).toLowerCase()}`;
        await fs.copyFile(path.join(DIR_IMG, n), path.join(pasta, dest));
        locais.push(dest);
      }
      const pedido = [
        `Crie o MAPA DE IDENTIDADE "${nome}" para manter as MESMAS características em vários vídeos gerados por IA (Veo, Kling, Seedance).`,
        locais.length ? `Abra com a ferramenta Read cada imagem de referência: ${locais.join(', ')}.` : '',
        notas ? `Informações do usuário: ${notas}` : '',
        '',
        'Escreva em INGLÊS um bloco de descrição FIXA, objetiva e visual, que será colado em todos os prompts. Inclua o que existir:',
        '- PERSON: idade aparente, etnia/tom de pele, rosto (formato, olhos, sobrancelhas, nariz, boca), cabelo (cor, comprimento, textura, penteado), corpo, marcas (sardas, tatuagens), maquiagem.',
        '- WARDROBE: roupa exata (peças, cores, tecido), acessórios.',
        '- VOICE & PERSONA: tipo de voz e jeito de falar (ex.: warm female voice, Brazilian Portuguese accent, energetic and friendly).',
        '- PRODUCT: formato, cores, rótulo, tampa, tamanho na mão (se houver produto).',
        '- SETTING: cenário recorrente, objetos, cores.',
        '- LOOK: luz, paleta de cor, câmera (ex.: handheld smartphone selfie, natural window light), estilo (UGC autêntico).',
        'Seja específico (cores e detalhes concretos), sem adjetivos vagos. Máximo ~170 palavras. Não invente o que não dá para ver: se faltar, escolha algo coerente e fixe.',
        '',
        'Responda SOMENTE com o bloco de texto.',
      ].filter(Boolean).join('\n');
      const r = await perguntarClaude({
        sistema: 'Você cria fichas de consistência de personagem e produto para geração de vídeo por IA.',
        pedido, modelo: 'claude-sonnet-5-5', timeoutMs: 240_000, pastaImagens: locais.length ? pasta : undefined,
      });
      const dna = r.texto.replace(/^```\w*\s*|```\s*$/g, '').trim();
      const perfis = await lerPerfis();
      const id = b.id && perfis.some((p) => p.id === b.id) ? b.id : `mapa-${Date.now().toString(36)}`;
      const perfil = { id, nome, imagens, notas, dna, criado: Date.now() };
      await gravarPerfis([perfil, ...perfis.filter((p) => p.id !== id)]);
      res.json(perfil);
    } catch (e) {
      res.status(400).json({ erro: e.message });
    } finally {
      fs.rm(pasta, { recursive: true, force: true }).catch(() => {});
    }
  });
  app.put('/api/kie/perfis/:id', express.json(), async (req, res) => {
    const perfis = await lerPerfis();
    const p = perfis.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ erro: 'Mapa não encontrado.' });
    if (typeof req.body?.dna === 'string') p.dna = req.body.dna.trim();
    if (typeof req.body?.nome === 'string' && req.body.nome.trim()) p.nome = req.body.nome.trim().slice(0, 60);
    await gravarPerfis(perfis);
    res.json(p);
  });
  app.delete('/api/kie/perfis/:id', async (req, res) => {
    await gravarPerfis((await lerPerfis()).filter((p) => p.id !== req.params.id));
    res.json({ ok: true });
  });

  // continuar um vídeo: o último quadro vira o primeiro quadro do próximo clipe
  app.post('/api/kie/continuar', express.json(), async (req, res) => {
    const h = await lerJson(ARQ_HIST, []);
    const x = h.find((y) => y.id === req.body?.id);
    if (!x?.midia) return res.status(400).json({ erro: 'Esse resultado não tem vídeo.' });
    const video = path.join(PASTAS.midia, x.midia);
    if (!existsSync(video)) return res.status(400).json({ erro: 'O vídeo não está mais na Mídia.' });
    await fs.mkdir(DIR_IMG, { recursive: true });
    const nome = `${Date.now()}-ultimo-quadro.png`;
    try {
      await new Promise((ok, falha) => {
        const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-sseof', '-0.15', '-i', video, '-frames:v', '1', path.join(DIR_IMG, nome)], { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        p.stderr.on('data', (d) => { err += d; });
        p.on('error', falha);
        p.on('close', (c) => (c === 0 && existsSync(path.join(DIR_IMG, nome)) ? ok() : falha(new Error('Não consegui extrair o último quadro. ' + err.slice(-200)))));
      });
      res.json({ imagem: { nome, url: `/kie/imagens/${encodeURIComponent(nome)}` }, anterior: { prompt: x.prompt, modelo: x.modelo, opcoes: x.opcoes, perfilId: x.perfilId || null } });
    } catch (e) { res.status(400).json({ erro: e.message }); }
  });

  /** Junta o prompt com o mapa (descrição fixa) para manter as características. */
  const comMapa = (prompt, perfil) => (perfil?.dna
    ? `${prompt}\n\nCONSISTENCY — keep EXACTLY these characteristics (same person, outfit, product and look as in previous videos):\n${perfil.dna}`
    : prompt);

  app.post('/api/kie/gerar', express.json(), async (req, res) => {
    let k;
    try { k = await exigirChave(); } catch (e) { return res.status(400).json({ erro: e.message }); }
    const b = req.body || {};
    const m = MODELOS_KIE.find((x) => x.id === b.modelo);
    if (!m) return res.status(400).json({ erro: 'Escolha um modelo.' });
    const prompt = String(b.prompt || '').trim();
    if (!prompt) return res.status(400).json({ erro: 'Escreva o prompt.' });
    let imagens = (b.imagens || []).map((n) => path.join(DIR_IMG, path.basename(n))).filter((a) => existsSync(a));
    const perfil = b.perfilId ? (await lerPerfis()).find((p) => p.id === b.perfilId) : null;
    const opcoes = {
      prompt: comMapa(prompt, perfil), usoImagem: b.usoImagem || 'quadro', aspecto: m.aspectos.includes(b.aspecto) ? b.aspecto : m.aspectos[0],
      duracao: m.duracoes.includes(+b.duracao) ? +b.duracao : m.duracoes[0], resolucao: m.resolucoes.includes(b.resolucao) ? b.resolucao : m.resolucoes[0],
      audio: b.audio !== false,
    };
    // fotos do personagem (mapa): vão como REFERÊNCIA nos modelos que aceitam (Veo Fast/Lite, Seedance).
    // Se houver primeiro quadro (ex.: continuação), ele manda e o personagem segue pela descrição fixa.
    const ACEITA_REF = [veo3_fast, veo3_lite, bytedance/seedance-2-fast];
    const fotosPerfil = (perfil?.imagens || []).map((n) => path.join(DIR_IMG, n)).filter((a) => existsSync(a));
    if (fotosPerfil.length && ACEITA_REF.includes(m.id) && (opcoes.usoImagem === referencia || !imagens.length)) {
      opcoes.usoImagem = referencia;
      imagens = [...fotosPerfil, ...imagens.filter((a) => !fotosPerfil.includes(a))];
    }
    imagens = imagens.slice(0, opcoes.usoImagem === referencia && m.id.startsWith(veo3) ? 3 : m.maxImagens);
    const job = criarJob('kie', { rotulo: `Gerando no Kie.ai (${m.nome})` });
    const item = { id: job.id, modelo: m.id, modeloNome: m.nome, prompt, perfilId: perfil?.id || null, perfilNome: perfil?.nome || null, opcoes: { ...opcoes, prompt: undefined }, imagens: (b.imagens || []).slice(0, m.maxImagens), status: 'gerando', criado: Date.now() };
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
