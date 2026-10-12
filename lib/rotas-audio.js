// Rotas da parte sonora: configurações (chave ElevenLabs), vozes, biblioteca de
// efeitos e os jobs de roteiro / voz / mapa de efeitos / efeitos de cada projeto.
import { createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import {
  PROVEDORES_VOZ, listarVozes, vozesEleven, modelosEleven, elevenAssinatura, sintetizarFala, extensaoVoz,
  efeitoEleven, montarFaixa, renderizarSomDeCodigo, normalizarArquivo, hash,
} from './audio.js';
import { escreverRoteiro, mapearEfeitos, sintetizarEfeitosEmCodigo } from './claude-audio.js';
import { sondar } from './ffmpeg.js';
import { transcrever, linhaDoTempoDaFala } from './transcricao.js';

const EXT_AUDIO = /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i;

export const audioPadrao = () => ({
  voz: {
    ativo: true, volume: 1, provedor: 'piper', voz: 'pt_BR-faber-medium', vozNome: '', modelo: '', velocidade: 1,
    tom: '', instrucoes: '', falas: [], arquivo: null, assinaturaGerada: null,
    gravacao: null, // { arquivo, nomeOriginal, duracao, deslocamento, transcricao }
  },
  efeitos: {
    ativo: true, volume: 0.8, motor: 'codigo', estilo: '', comTrilha: false, lista: [],
    arquivo: null, assinaturaGerada: null,
  },
});

const assinaturaVoz = (v) => (v.provedor === 'arquivo'
  ? hash('arquivo', v.gravacao?.arquivo, v.gravacao?.deslocamento || 0)
  : hash(v.provedor, v.voz, v.modelo, v.velocidade, v.falas.map((f) => [f.inicio, f.texto])));
const assinaturaEfeitos = (e) => hash(e.motor, e.comTrilha, e.motor === 'codigo' ? e.estilo : '',
  e.lista.map((x) => [x.inicio, x.duracao, x.descricao, x.volume, x.arquivoBiblioteca]));

/** Completa o objeto de áudio e marca se o que foi gerado está desatualizado. */
export function estadoAudio(p) {
  const pad = audioPadrao();
  const a = { voz: { ...pad.voz, ...(p.audio?.voz || {}) }, efeitos: { ...pad.efeitos, ...(p.audio?.efeitos || {}) } };
  const temVoz = a.voz.provedor === 'arquivo' ? !!a.voz.gravacao : !!a.voz.falas.length;
  a.voz.pendente = temVoz && a.voz.assinaturaGerada !== assinaturaVoz(a.voz);
  a.efeitos.pendente = !!a.efeitos.lista.length && a.efeitos.assinaturaGerada !== assinaturaEfeitos(a.efeitos);
  return a;
}

/** Faixas que entram no render do projeto. */
export function faixasDoProjeto(p, pastaProjeto, deslocamento = 0) {
  const a = estadoAudio(p);
  const faixas = [];
  for (const k of ['voz', 'efeitos']) {
    const t = a[k];
    const arq = t.arquivo && path.join(pastaProjeto, 'audio', t.arquivo);
    if (t.ativo && arq && existsSync(arq)) faixas.push({ arquivo: arq, volume: t.volume, deslocamento, tipo: k });
  }
  return faixas;
}

export function registrarRotasAudio(app, ctx) {
  const { DADOS, PASTAS, lerProjeto, salvarProjeto, pastaProjeto, criarJob, msgJob, jobPublico, lerJson, gravarJson, slugify } = ctx;
  const ARQ_CONFIG = path.join(DADOS, 'config.json');
  const lerConfig = () => lerJson(ARQ_CONFIG, {});
  const pastaAudio = async (id) => { const d = path.join(pastaProjeto(id), 'audio'); await fs.mkdir(d, { recursive: true }); return d; };
  const jobsAudio = new Map(); // projetoId -> job em andamento

  // ---------------------------------------------------------------- configurações
  app.get('/api/config', async (_req, res) => {
    const c = await lerConfig();
    res.json({ elevenlabs: { configurado: !!c.elevenlabsKey, final: c.elevenlabsKey ? c.elevenlabsKey.slice(-4) : null } });
  });
  app.put('/api/config', async (req, res) => {
    const c = await lerConfig();
    if ('elevenlabsKey' in (req.body || {})) {
      const chave = String(req.body.elevenlabsKey || '').trim();
      if (chave) {
        // Só recusa chave inválida. Chave válida com permissões restritas é aceita,
        // e avisamos o que falta (a geração de voz/efeitos não precisa de user_read).
        const semPermissao = (e) => /permission/i.test(e.message);
        let info = null;
        const avisos = [];
        try {
          info = await elevenAssinatura(chave);
        } catch (e) {
          if (!semPermissao(e)) return res.status(400).json({ erro: 'Chave recusada: ' + e.message });
          avisos.push('sem “User → Read”: o plano e os créditos não aparecem aqui (não atrapalha a geração)');
        }
        try {
          await vozesEleven(chave);
        } catch (e) {
          if (!semPermissao(e)) return res.status(400).json({ erro: 'Chave recusada: ' + e.message });
          avisos.push('sem “Voices → Read”: aparecem só as vozes padrão da ElevenLabs (ative a permissão para ver as vozes da sua conta)');
        }
        c.elevenlabsKey = chave;
        await gravarJson(ARQ_CONFIG, c);
        return res.json({ ok: true, elevenlabs: info, avisos });
      }
      delete c.elevenlabsKey;
      await gravarJson(ARQ_CONFIG, c);
    }
    res.json({ ok: true });
  });
  app.get('/api/config/elevenlabs', async (_req, res) => {
    try { res.json(await elevenAssinatura((await lerConfig()).elevenlabsKey)); }
    catch (e) { res.status(400).json({ erro: e.message }); }
  });

  // ---------------------------------------------------------------- vozes
  app.get('/api/audio/provedores', (_req, res) => res.json(PROVEDORES_VOZ));
  app.get('/api/audio/vozes', async (req, res) => {
    try { res.json(await listarVozes(String(req.query.provedor || 'piper'), await lerConfig())); }
    catch (e) { res.status(400).json({ erro: e.message }); }
  });
  app.get('/api/audio/modelos-eleven', async (_req, res) => {
    try { res.json(await modelosEleven((await lerConfig()).elevenlabsKey)); }
    catch (e) { res.status(400).json({ erro: e.message }); }
  });

  // ---------------------------------------------------------------- biblioteca de vozes ElevenLabs (estilo do site)
  const anosOuDias = (unix) => {
    if (!unix) return '';
    const dias = Math.floor((Date.now() / 1000 - unix) / 86400);
    if (dias < 30) return `${dias}d`;
    if (dias < 365) return `${Math.floor(dias / 30)} mês${dias >= 60 ? 'es' : ''}`.replace('mêses', 'meses');
    const a = Math.floor(dias / 365);
    return `${a} ano${a > 1 ? 's' : ''}`;
  };
  const vozDaBiblioteca = (v) => ({
    id: `biblioteca:${v.public_owner_id}:${v.voice_id}`,
    nome: v.name, descricao: v.description || '', imagem: v.image_url || null,
    genero: v.gender || '', idade: v.age || '', estilo: v.descriptive || '', uso: v.use_case || '',
    idioma: v.language || 'pt', sotaque: v.accent || '', categoria: v.category || '',
    verificada: (v.verified_languages || []).length > 0, idiomasExtras: Math.max(0, (v.verified_languages || []).length - 1),
    usuarios: v.cloned_by_count || 0, criada: anosOuDias(v.date_unix), preview: v.preview_url
      || (v.verified_languages || []).find((l) => /pt/i.test(l.language || l.locale || ''))?.preview_url || null,
    adicionada: !!v.is_added_by_user,
  });
  const erroEleven = (res, e) => res.status(/permission/i.test(e.message) ? 403 : 400)
    .json({ erro: e.message, semPermissao: /voices_read|permission/i.test(e.message) });

  app.get('/api/audio/eleven/biblioteca', async (req, res) => {
    const chave = (await lerConfig()).elevenlabsKey;
    const q = new URLSearchParams({
      language: 'pt', accent: 'brazilian', page_size: '30', page: String(Math.max(0, +req.query.pagina || 0)),
      sort: { usadas: 'cloned_by_count', recentes: 'created_date', alta: 'trending' }[req.query.ordem] || 'trending',
    });
    if (['female', 'male', 'neutral'].includes(req.query.genero)) q.set('gender', req.query.genero);
    if (req.query.busca) q.set('search', String(req.query.busca).slice(0, 80));
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${q}`, { headers: { 'xi-api-key': chave || '' } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail?.message || JSON.stringify(j.detail || j).slice(0, 300));
      res.json({ vozes: (j.voices || []).map(vozDaBiblioteca), temMais: !!j.has_more, total: j.total_count ?? null });
    } catch (e) { erroEleven(res, e); }
  });

  app.get('/api/audio/eleven/minhas', async (req, res) => {
    try {
      const vozes = await vozesEleven((await lerConfig()).elevenlabsKey);
      const busca = String(req.query.busca || '').toLowerCase();
      res.json({ vozes: vozes.filter((v) => v.grupo === 'Minhas vozes' && (!busca || `${v.nome} ${v.info}`.toLowerCase().includes(busca))) });
    } catch (e) { erroEleven(res, e); }
  });

  // ---------------------------------------------------------------- biblioteca de efeitos
  async function listarBiblioteca(dir = PASTAS.sfx, prefixo = '') {
    const itens = [];
    for (const d of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const rel = prefixo ? `${prefixo}/${d.name}` : d.name;
      if (d.isDirectory()) itens.push(...await listarBiblioteca(path.join(dir, d.name), rel));
      else if (EXT_AUDIO.test(d.name)) itens.push(rel);
    }
    return itens;
  }
  const caminhoBiblioteca = (rel) => {
    const abs = path.resolve(PASTAS.sfx, rel);
    if (!abs.startsWith(path.resolve(PASTAS.sfx) + path.sep)) throw new Error('Caminho inválido');
    return abs;
  };
  app.use('/arquivos/sfx', express.static(PASTAS.sfx));
  app.get('/api/audio/biblioteca', async (_req, res) => res.json(await listarBiblioteca()));
  app.post('/api/audio/biblioteca/upload', async (req, res) => {
    const original = path.basename(String(req.query.nome || 'som.mp3'));
    const ext = path.extname(original).toLowerCase();
    if (!EXT_AUDIO.test(ext)) return res.status(400).json({ erro: 'Formato de áudio não suportado.' });
    const pasta = path.join(PASTAS.sfx, 'importados');
    await fs.mkdir(pasta, { recursive: true });
    let nome = `${slugify(path.basename(original, ext))}${ext}`;
    for (let i = 2; existsSync(path.join(pasta, nome)); i++) nome = `${slugify(path.basename(original, ext))}-${i}${ext}`;
    const ws = createWriteStream(path.join(pasta, nome));
    req.pipe(ws);
    ws.on('finish', () => res.json({ nome: `importados/${nome}` }));
    ws.on('error', (e) => res.status(500).json({ erro: e.message }));
  });
  app.post('/api/audio/biblioteca/abrir', (_req, res) => {
    spawn('explorer', [PASTAS.sfx], { detached: true, stdio: 'ignore' }).unref();
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- arquivos de áudio do projeto
  app.get('/p/:id/audio/:arquivo', (req, res) => {
    const arq = path.join(pastaProjeto(req.params.id), 'audio', path.basename(req.params.arquivo));
    if (!existsSync(arq)) return res.status(404).end();
    res.set('Cache-Control', 'no-store');
    res.sendFile(arq);
  });

  // salva o que o usuário editou (falas, efeitos, motores, volumes)
  app.put('/api/projetos/:id/audio', async (req, res) => {
    const p = await lerProjeto(req.params.id);
    if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
    const atual = estadoAudio(p);
    const { voz = {}, efeitos = {} } = req.body || {};
    const limpar = (o, campos) => Object.fromEntries(Object.entries(o).filter(([k]) => campos.includes(k)));
    p.audio = {
      voz: { ...atual.voz, ...limpar(voz, ['ativo', 'volume', 'provedor', 'voz', 'vozNome', 'modelo', 'velocidade', 'tom', 'instrucoes', 'falas']) },
      efeitos: { ...atual.efeitos, ...limpar(efeitos, ['ativo', 'volume', 'motor', 'estilo', 'comTrilha', 'lista']) },
    };
    p.audio.voz.falas = (p.audio.voz.falas || []).map((f) => ({ ...f, inicio: Math.max(0, +f.inicio || 0), texto: String(f.texto || '') }));
    p.audio.efeitos.lista = (p.audio.efeitos.lista || []).map((e) => ({
      ...e, inicio: Math.max(0, +e.inicio || 0), duracao: Math.min(30, Math.max(0.5, +e.duracao || 1)),
      volume: Math.min(1.5, Math.max(0, +e.volume || 0)), descricao: String(e.descricao || ''),
    }));
    delete p.audio.voz.pendente;
    delete p.audio.efeitos.pendente;
    await salvarProjeto(p);
    res.json(estadoAudio(p));
  });

  // ---------------------------------------------------------------- jobs de áudio
  function iniciarJobAudio(req, res, rotulo, trabalho) {
    return (async () => {
      const p = await lerProjeto(req.params.id);
      if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
      const emCurso = jobsAudio.get(p.id);
      if (emCurso && (emCurso.status === 'rodando' || emCurso.status === 'fila')) {
        return res.status(409).json({ erro: 'Já existe uma tarefa de áudio em andamento neste projeto.' });
      }
      const job = criarJob('audio', { projetoId: p.id, rotulo });
      jobsAudio.set(p.id, job);
      job.status = 'rodando';
      msgJob(job, rotulo + '…');
      res.json({ job: jobPublico(job) });
      try {
        await trabalho(job, p);
        job.status = 'ok';
        job.progresso = 1;
      } catch (e) {
        job.status = 'erro';
        job.erro = e.message;
        msgJob(job, 'Erro: ' + e.message);
      }
    })();
  }
  const progressoClaude = (job) => (chars, msg) => {
    if (msg) msgJob(job, msg);
    if (chars) job.ultima = `Claude escrevendo… ${(chars / 1000).toFixed(1)}k caracteres`;
  };
  const htmlAtual = (p) => fs.readFile(path.join(pastaProjeto(p.id), `v${p.versaoAtual}.html`), 'utf8');
  const exigirVersao = (p) => { if (!p.versaoAtual) throw new Error('O projeto ainda não tem animação.'); };
  // relê o projeto antes de gravar o resultado (o usuário pode ter editado no meio)
  async function gravarAudio(id, alterar) {
    const p = await lerProjeto(id);
    p.audio = estadoAudio(p);
    alterar(p.audio);
    delete p.audio.voz.pendente;
    delete p.audio.efeitos.pendente;
    await salvarProjeto(p);
  }

  app.post('/api/projetos/:id/audio/roteiro', (req, res) => iniciarJobAudio(req, res, 'Escrevendo o roteiro da locução', async (job, p) => {
    exigirVersao(p);
    const a = estadoAudio(p);
    const falas = await escreverRoteiro({
      html: await htmlAtual(p), ajustes: p.ajustes, tom: a.voz.tom, instrucoes: a.voz.instrucoes,
      modelo: req.body?.modelo, aoProgresso: progressoClaude(job), sinal: job.controle.signal,
    });
    await gravarAudio(p.id, (au) => { au.voz.falas = falas; });
    msgJob(job, `Roteiro com ${falas.length} falas.`);
  }));

  app.post('/api/projetos/:id/audio/mapa', (req, res) => iniciarJobAudio(req, res, 'Mapeando os momentos de efeito sonoro', async (job, p) => {
    exigirVersao(p);
    const a = estadoAudio(p);
    const biblioteca = a.efeitos.motor === 'biblioteca' ? (await listarBiblioteca()).slice(0, 600) : [];
    if (a.efeitos.motor === 'biblioteca' && !biblioteca.length) throw new Error('A biblioteca de efeitos está vazia. Importe sons primeiro.');
    const lista = await mapearEfeitos({
      html: await htmlAtual(p), ajustes: p.ajustes, estilo: a.efeitos.estilo, biblioteca,
      modelo: req.body?.modelo, aoProgresso: progressoClaude(job), sinal: job.controle.signal,
    });
    await gravarAudio(p.id, (au) => { au.efeitos.lista = lista; });
    msgJob(job, `${lista.length} momentos de efeito.`);
  }));

  app.post('/api/projetos/:id/audio/voz', (req, res) => iniciarJobAudio(req, res, 'Gerando a voz', async (job, p) => {
    const cfg = await lerConfig();
    const v = estadoAudio(p).voz;
    if (v.provedor === 'arquivo') {
      if (!v.gravacao) throw new Error('Envie o seu áudio primeiro.');
      await montarVozGravada(p.id);
      return;
    }
    const falas = v.falas.filter((f) => f.texto.trim());
    if (!falas.length) throw new Error('Escreva ou gere o roteiro primeiro.');
    const dir = await pastaAudio(p.id);
    const ext = extensaoVoz(v.provedor);
    for (let i = 0; i < falas.length; i++) {
      if (job.controle.signal.aborted) throw new Error('Cancelado');
      const f = falas[i];
      const nome = `fala-${hash(v.provedor, v.voz, v.modelo, v.velocidade, f.texto)}${ext}`;
      const arq = path.join(dir, nome);
      if (!existsSync(arq)) {
        job.ultima = `Fala ${i + 1}/${falas.length}: “${f.texto.slice(0, 40)}…”`;
        await sintetizarFala({
          provedor: v.provedor, voz: v.voz, modelo: v.modelo, velocidade: v.velocidade, texto: f.texto,
          saida: arq, pastaVozes: PASTAS.vozes, pastaTemp: PASTAS.temp,
        }, cfg);
      }
      f.arquivo = nome;
      f.duracao = (await sondar(arq)).duracao;
      job.progresso = (i + 1) / (falas.length + 1);
    }
    const fim = Math.max(p.ajustes.duracao, ...falas.map((f) => f.inicio + f.duracao));
    const assinatura = assinaturaVoz(v);
    const nomeFaixa = `voz-${assinatura}.wav`;
    msgJob(job, 'Mixando as falas…');
    await montarFaixa(falas.map((f) => ({ arquivo: path.join(dir, f.arquivo), inicio: f.inicio })), fim, path.join(dir, nomeFaixa), { alvoLufs: -16 });
    const porTexto = new Map(falas.map((f) => [`${f.inicio}|${f.texto}`, f]));
    await gravarAudio(p.id, (au) => {
      au.voz.falas = au.voz.falas.map((f) => {
        const g = porTexto.get(`${f.inicio}|${f.texto}`);
        return g ? { ...f, arquivo: g.arquivo, duracao: g.duracao } : f;
      });
      au.voz.arquivo = nomeFaixa;
      au.voz.assinaturaGerada = assinatura;
    });
    msgJob(job, `Voz pronta (${falas.length} falas).`);
  }));

  app.post('/api/projetos/:id/audio/efeitos', (req, res) => iniciarJobAudio(req, res, 'Gerando os efeitos sonoros', async (job, p) => {
    exigirVersao(p);
    const cfg = await lerConfig();
    let e = estadoAudio(p).efeitos;
    const dir = await pastaAudio(p.id);
    if (!e.lista.length) {
      msgJob(job, 'Sem mapa de efeitos: pedindo ao Claude para mapear os momentos…');
      const biblioteca = e.motor === 'biblioteca' ? (await listarBiblioteca()).slice(0, 600) : [];
      const lista = await mapearEfeitos({
        html: await htmlAtual(p), ajustes: p.ajustes, estilo: e.estilo, biblioteca,
        modelo: req.body?.modelo, aoProgresso: progressoClaude(job), sinal: job.controle.signal,
      });
      await gravarAudio(p.id, (au) => { au.efeitos.lista = lista; });
      e = { ...e, lista };
    }
    const assinatura = assinaturaEfeitos(e);
    const nomeFaixa = `efeitos-${assinatura}.wav`;
    const saida = path.join(dir, nomeFaixa);
    const duracao = p.ajustes.duracao;

    if (e.motor === 'codigo') {
      const script = await sintetizarEfeitosEmCodigo({
        html: await htmlAtual(p), ajustes: p.ajustes, efeitos: e.lista, comTrilha: e.comTrilha, estilo: e.estilo,
        modelo: req.body?.modelo, aoProgresso: progressoClaude(job), sinal: job.controle.signal,
      });
      await fs.writeFile(path.join(dir, `som-${assinatura}.js`), script, 'utf8');
      msgJob(job, 'Sintetizando o áudio…');
      await renderizarSomDeCodigo({ script, duracao, saida });
      await normalizarArquivo(saida, -20);
    } else {
      const trechos = [];
      const pastaEleven = path.join(PASTAS.sfx, 'elevenlabs');
      await fs.mkdir(pastaEleven, { recursive: true });
      let semArquivo = 0;
      for (let i = 0; i < e.lista.length; i++) {
        if (job.controle.signal.aborted) throw new Error('Cancelado');
        const x = e.lista[i];
        let arq = null;
        if (e.motor === 'elevenlabs') {
          arq = path.join(pastaEleven, `${slugify(x.descricao).slice(0, 40)}-${hash(x.descricao, x.duracao)}.mp3`);
          if (!existsSync(arq)) {
            job.ultima = `Efeito ${i + 1}/${e.lista.length}: ${x.descricao}`;
            await efeitoEleven({ descricao: x.descricao, duracao: x.duracao, saida: arq, chave: cfg.elevenlabsKey });
          }
        } else if (x.arquivoBiblioteca) {
          arq = caminhoBiblioteca(x.arquivoBiblioteca);
          if (!existsSync(arq)) arq = null;
        }
        if (arq) trechos.push({ arquivo: arq, inicio: x.inicio, volume: x.volume, duracao: x.duracao });
        else semArquivo++;
        job.progresso = (i + 1) / (e.lista.length + 1);
      }
      if (!trechos.length) throw new Error('Nenhum efeito tem som associado. Escolha arquivos da biblioteca para os momentos.');
      if (semArquivo) msgJob(job, `${semArquivo} momento(s) sem som da biblioteca foram pulados.`);
      msgJob(job, 'Mixando os efeitos…');
      await montarFaixa(trechos, duracao, saida, { alvoLufs: -20 });
    }
    await gravarAudio(p.id, (au) => { au.efeitos.arquivo = nomeFaixa; au.efeitos.assinaturaGerada = assinatura; });
    msgJob(job, 'Efeitos prontos.');
  }));

  // ---------------------------------------------------------------- meu áudio gravado
  const EXT_GRAVACAO = /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm|mp4|mov|mkv)$/i;

  /** Monta a faixa de voz a partir da gravação (com atraso/corte) e normaliza para nível de locução. */
  async function montarVozGravada(id) {
    const p = await lerProjeto(id);
    const v = estadoAudio(p).voz;
    if (!v.gravacao) return;
    const dir = await pastaAudio(id);
    const desl = +v.gravacao.deslocamento || 0;
    const assinatura = assinaturaVoz(v);
    const nomeFaixa = `voz-${assinatura}.wav`;
    const fim = Math.max(p.ajustes.duracao, desl + v.gravacao.duracao);
    await montarFaixa([{ arquivo: path.join(dir, v.gravacao.arquivo), inicio: Math.max(0, desl), cortarInicio: Math.max(0, -desl) }],
      fim, path.join(dir, nomeFaixa), { alvoLufs: -16 });
    await gravarAudio(id, (au) => { au.voz.arquivo = nomeFaixa; au.voz.assinaturaGerada = assinatura; });
  }

  const dicaDoProjeto = (p) => [p.ajustes?.tema, p.ajustes?.textos, p.nome].filter(Boolean).join('. ');

  async function transcreverGravacao(job, id) {
    const p = await lerProjeto(id);
    const v = estadoAudio(p).voz;
    job.ultima = 'Transcrevendo a fala (Whisper, offline)… na 1ª vez baixa o modelo';
    const t = await transcrever({
      arquivo: path.join(pastaProjeto(id), 'audio', v.gravacao.arquivo),
      pastaTemp: PASTAS.temp, dica: dicaDoProjeto(p), sinal: job.controle.signal,
    });
    await gravarAudio(id, (au) => { au.voz.gravacao = { ...au.voz.gravacao, transcricao: t, duracao: t.duracao }; });
    msgJob(job, `Transcrito: ${t.frases.length} frases, ${t.duracao.toFixed(1)}s.`);
    await montarVozGravada(id);
  }

  // envia a gravação para o projeto (corpo cru) e já transcreve
  app.post('/api/projetos/:id/audio/gravacao', async (req, res) => {
    const p = await lerProjeto(req.params.id);
    if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
    const original = path.basename(String(req.query.nome || 'gravacao.mp3'));
    const ext = path.extname(original).toLowerCase();
    if (!EXT_GRAVACAO.test(ext)) return res.status(400).json({ erro: 'Envie um arquivo de áudio (MP3, WAV, M4A…) ou vídeo.' });
    const dir = await pastaAudio(p.id);
    const nome = `gravacao-${Date.now()}${ext}`;
    await new Promise((ok, falha) => {
      const ws = createWriteStream(path.join(dir, nome));
      req.pipe(ws);
      ws.on('finish', ok);
      ws.on('error', falha);
    });
    const info = await sondar(path.join(dir, nome));
    if (!info.temAudio) return res.status(400).json({ erro: 'Esse arquivo não tem áudio.' });
    await gravarAudio(p.id, (au) => {
      au.voz.provedor = 'arquivo';
      au.voz.gravacao = { arquivo: nome, nomeOriginal: original, duracao: info.duracao, deslocamento: 0, transcricao: null };
    });
    iniciarJobAudio(req, res, 'Transcrevendo o seu áudio', (job) => transcreverGravacao(job, p.id));
  });

  app.post('/api/projetos/:id/audio/transcrever', (req, res) => iniciarJobAudio(req, res, 'Transcrevendo o seu áudio', async (job, p) => {
    if (!estadoAudio(p).voz.gravacao) throw new Error('Envie um áudio primeiro.');
    await transcreverGravacao(job, p.id);
  }));

  app.patch('/api/projetos/:id/audio/gravacao', async (req, res) => {
    const p = await lerProjeto(req.params.id);
    if (!estadoAudio(p || {}).voz.gravacao) return res.status(400).json({ erro: 'Sem gravação neste projeto.' });
    const desl = Math.max(-600, Math.min(600, +req.body?.deslocamento || 0));
    await gravarAudio(p.id, (au) => { au.voz.gravacao.deslocamento = desl; });
    try { await montarVozGravada(p.id); } catch (e) { return res.status(500).json({ erro: e.message }); }
    res.json(estadoAudio(await lerProjeto(p.id)));
  });

  /** Linha do tempo da fala gravada (para mandar ao Claude), ou null. */
  function locucaoDoProjeto(p) {
    const g = estadoAudio(p).voz.gravacao;
    if (estadoAudio(p).voz.provedor !== 'arquivo' || !g?.transcricao) return null;
    return linhaDoTempoDaFala(g.transcricao, +g.deslocamento || 0);
  }

  // o Claude refaz os tempos da animação para casar com a fala gravada
  app.post('/api/projetos/:id/audio/sincronizar', async (req, res) => {
    const p = await lerProjeto(req.params.id);
    if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
    if (p.status === 'gerando') return res.status(409).json({ erro: 'Já existe uma geração em andamento.' });
    const locucao = locucaoDoProjeto(p);
    if (!locucao) return res.status(400).json({ erro: 'Envie e transcreva o seu áudio primeiro.' });
    const g = estadoAudio(p).voz.gravacao;
    if (req.body?.ajustarDuracao !== false) {
      p.ajustes.duracao = Math.ceil(((+g.deslocamento || 0) + g.duracao + 0.4) * 10) / 10;
    }
    if (req.body?.modelo) p.modelo = req.body.modelo;
    let pedido;
    if (p.versaoAtual) {
      const htmlAtual = await fs.readFile(path.join(pastaProjeto(p.id), `v${p.versaoAtual}.html`), 'utf8');
      pedido = ctx.montarSincronia({ htmlAtual, locucao, ajustes: p.ajustes });
    } else {
      pedido = ctx.montarPedido({ prompt: p.prompt, ajustes: p.ajustes, locucao });
    }
    await salvarProjeto(p);
    const job = ctx.iniciarGeracao(p, pedido, 'refino', 'Sincronizado com a locução gravada');
    res.json({ job: jobPublico(job) });
  });

  // criar projeto a partir de uma locução: transcreve antes de o projeto existir
  app.post('/api/audio/locucao', async (req, res) => {
    const original = path.basename(String(req.query.nome || 'locucao.mp3'));
    const ext = path.extname(original).toLowerCase();
    if (!EXT_GRAVACAO.test(ext)) return res.status(400).json({ erro: 'Envie um arquivo de áudio (MP3, WAV, M4A…) ou vídeo.' });
    const base = `locucao-${Date.now().toString(36)}`;
    const arq = path.join(PASTAS.temp, base + ext);
    await new Promise((ok, falha) => {
      const ws = createWriteStream(arq);
      req.pipe(ws);
      ws.on('finish', ok);
      ws.on('error', falha);
    });
    const job = criarJob('audio', { rotulo: 'Transcrevendo a locução' });
    job.status = 'rodando';
    job.ultima = 'Transcrevendo a fala (Whisper, offline)… na 1ª vez baixa o modelo';
    res.json({ job: jobPublico(job) });
    try {
      const t = await transcrever({ arquivo: arq, pastaTemp: PASTAS.temp, dica: String(req.query.dica || ''), sinal: job.controle.signal });
      await gravarJson(path.join(PASTAS.temp, base + '.json'), { arquivo: base + ext, nomeOriginal: original, transcricao: t });
      job.resultado = { locucao: base, duracao: t.duracao, frases: t.frases.length, texto: t.texto };
      job.status = 'ok';
      job.progresso = 1;
      msgJob(job, `Transcrito: ${t.frases.length} frases, ${t.duracao.toFixed(1)}s.`);
    } catch (e) {
      job.status = 'erro';
      job.erro = e.message;
    }
  });

  /** Usado na criação do projeto: move a locução transcrita para dentro dele e devolve a linha do tempo. */
  async function anexarLocucao(p, base) {
    if (!/^locucao-[a-z0-9]+$/.test(base || '')) throw new Error('Locução inválida.');
    const meta = await lerJson(path.join(PASTAS.temp, base + '.json'), null);
    if (!meta) throw new Error('A locução enviada não foi encontrada (transcreva de novo).');
    const dir = await pastaAudio(p.id);
    const nome = `gravacao-${Date.now()}${path.extname(meta.arquivo)}`;
    await fs.rename(path.join(PASTAS.temp, meta.arquivo), path.join(dir, nome));
    await fs.rm(path.join(PASTAS.temp, base + '.json'), { force: true });
    p.audio = estadoAudio(p);
    p.audio.voz.provedor = 'arquivo';
    p.audio.voz.gravacao = { arquivo: nome, nomeOriginal: meta.nomeOriginal, duracao: meta.transcricao.duracao, deslocamento: 0, transcricao: meta.transcricao };
    delete p.audio.voz.pendente;
    delete p.audio.efeitos.pendente;
    await salvarProjeto(p);
    await montarVozGravada(p.id);
    return { locucao: linhaDoTempoDaFala(meta.transcricao, 0), duracao: meta.transcricao.duracao };
  }

  app.get('/api/projetos/:id/audio/job', (req, res) => {
    const j = jobsAudio.get(req.params.id);
    res.json(j ? jobPublico(j) : null);
  });

  return { anexarLocucao, locucaoDoProjeto };
}
