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
import { escreverRoteiro, escreverLocucao, encaixarFalas } from './claude-audio.js';
import { planejarSonorizacao, sintetizarPlanoEmCodigo } from './sonoplastia-ia.js';
import { analisarVideo } from './analise-video.js';
import { garantirIR, processarSom, posicionar, mixarSonorizacao } from './mixagem-sfx.js';
import { ehTatil } from './som-tatil.js';
import { sondar, FFMPEG } from './ffmpeg.js';
import { transcrever, linhaDoTempoDaFala } from './transcricao.js';

const EXT_AUDIO = /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i;

export const audioPadrao = () => ({
  voz: {
    ativo: true, volume: 1, provedor: 'piper', voz: 'pt_BR-faber-medium', vozNome: '', modelo: '', velocidade: 1, interpretacao: 'natural',
    tom: '', instrucoes: '', falas: [], arquivo: null, assinaturaGerada: null,
    gravacao: null, // { arquivo, nomeOriginal, duracao, deslocamento, transcricao }
  },
  efeitos: {
    ativo: true, volume: 0.8, motor: 'codigo', estilo: '', intensidade: 'equilibrado', comAmbiente: true, comTrilha: false, lista: [],
    conceito: '', ambiente: null, silencios: [], analise: null, arquivo: null, assinaturaGerada: null,
  },
});

const idiomaDoProjeto = (p) => ({ 'Inglês': 'en', 'Espanhol': 'es' }[p.ajustes?.idioma] || 'pt');
const assinaturaVoz = (v) => (v.provedor === 'arquivo'
  ? hash('arquivo', v.gravacao?.arquivo, v.gravacao?.deslocamento || 0)
  : hash('v2', v.provedor, v.voz, v.modelo, v.velocidade, v.interpretacao, v.falas.map((f) => [f.inicio, f.texto])));
const assinaturaEfeitos = (e) => hash('sfx2', e.motor, e.comTrilha, e.motor === 'codigo' ? e.estilo : '', e.comAmbiente,
  e.ambiente && [e.ambiente.descricao, e.ambiente.volume, e.ambiente.variante], e.silencios,
  e.lista.map((x) => [x.inicio, x.alinhar, x.duracao, x.categoria, x.descricao, x.camadas, x.volume, x.pan, x.reverb, x.arquivoBiblioteca, x.variante]));

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
  // ctx.renderizarHtml e ctx.BASE: usados para "assistir" à animação na sonoplastia
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
      voz: { ...atual.voz, ...limpar(voz, ['ativo', 'volume', 'provedor', 'voz', 'vozNome', 'modelo', 'interpretacao', 'velocidade', 'tom', 'instrucoes', 'falas']) },
      efeitos: { ...atual.efeitos, ...limpar(efeitos, ['ativo', 'volume', 'motor', 'estilo', 'intensidade', 'comAmbiente', 'comTrilha', 'lista', 'ambiente', 'silencios']) },
    };
    p.audio.voz.falas = (p.audio.voz.falas || []).map((f) => ({ ...f, inicio: Math.max(0, +f.inicio || 0), texto: String(f.texto || '') }));
    p.audio.efeitos.lista = (p.audio.efeitos.lista || []).map((e) => ({
      ...e, inicio: Math.max(0, +e.inicio || 0), duracao: Math.min(30, Math.max(0.4, +e.duracao || 1)),
      volume: Math.min(1.5, Math.max(0, +e.volume || 0)), descricao: String(e.descricao || ''),
      pan: Math.min(1, Math.max(-1, +e.pan || 0)), reverb: Math.min(1, Math.max(0, +e.reverb || 0)), variante: Math.max(0, +e.variante || 0),
      alinhar: ['inicio', 'fim', 'centro'].includes(e.alinhar) ? e.alinhar : 'inicio', camadas: Array.isArray(e.camadas) ? e.camadas.slice(0, 3) : [],
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
    const { analise, dirAn } = await assistirVideo(job, p);
    msgJob(job, 'A IA está assistindo ao vídeo e escrevendo a locução…');
    const falas = await escreverRoteiro({
      html: await htmlAtual(p), ajustes: p.ajustes, tom: a.voz.tom, instrucoes: a.voz.instrucoes,
      analise, pastaFolhas: dirAn, velocidade: a.voz.velocidade,
      modelo: req.body?.modelo, aoProgresso: progressoClaude(job), sinal: job.controle.signal,
    });
    await gravarAudio(p.id, (au) => { au.voz.falas = falas; });
    msgJob(job, `Roteiro com ${falas.length} falas.`);
  }));

  app.post('/api/projetos/:id/audio/testar-voz', async (req, res) => {
    try {
      const p = await lerProjeto(req.params.id);
      if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
      const v = estadoAudio(p).voz;
      if (v.provedor === 'arquivo') return res.status(400).json({ erro: 'Esse motor usa a sua gravação.' });
      const texto = String(req.body?.texto || v.falas.find((f) => f.texto.trim())?.texto || 'Olá! Esta é a voz que vai narrar o seu vídeo.').slice(0, 300);
      const dir = await pastaAudio(p.id);
      const nome = `teste-${hash('v2', v.provedor, v.voz, v.modelo, v.velocidade, v.interpretacao, texto)}${extensaoVoz(v.provedor)}`;
      const arq = path.join(dir, nome);
      if (!existsSync(arq)) {
        await sintetizarFala({ provedor: v.provedor, voz: v.voz, modelo: v.modelo, velocidade: v.velocidade, texto,
          idioma: idiomaDoProjeto(p), interpretacao: v.interpretacao, saida: arq, pastaVozes: PASTAS.vozes, pastaTemp: PASTAS.temp }, await lerConfig());
      }
      res.json({ url: `/p/${p.id}/audio/${nome}`, texto });
    } catch (e) { res.status(400).json({ erro: e.message }); }
  });

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
      // "v2": versão do gerador (idioma fixo + contexto + texto normalizado) — refaz as falas antigas
      const nome = `fala-${hash('v2', v.provedor, v.voz, v.modelo, v.velocidade, v.interpretacao, f.texto)}${ext}`;
      const arq = path.join(dir, nome);
      if (!existsSync(arq)) {
        job.ultima = `Fala ${i + 1}/${falas.length}: “${f.texto.slice(0, 40)}…”`;
        await sintetizarFala({
          provedor: v.provedor, voz: v.voz, modelo: v.modelo, velocidade: v.velocidade, texto: f.texto,
          anterior: falas[i - 1]?.texto, proxima: falas[i + 1]?.texto,
          idioma: idiomaDoProjeto(p), interpretacao: v.interpretacao,
          saida: arq, pastaVozes: PASTAS.vozes, pastaTemp: PASTAS.temp,
        }, cfg);
      }
      f.arquivo = nome;
      f.duracao = (await sondar(arq)).duracao;
      job.progresso = (i + 1) / (falas.length + 1);
    }
    // ORGANIZADOR: nenhuma fala começa antes de a anterior terminar.
    // Se uma fala não cabe até a próxima, acelera um pouco (até 1,2×, sem mudar o tom); se ainda não couber, a próxima espera.
    const RESPIRO = 0.15;
    let fimAnterior = 0;
    let ajustadas = 0;
    falas.forEach((f, i) => {
      const inicio = Math.max(f.inicio, i ? fimAnterior + RESPIRO : f.inicio);
      const limite = falas[i + 1]?.inicio ?? p.ajustes.duracao;
      const janela = limite - RESPIRO - inicio;
      let tempo = 1;
      if (f.duracao > janela && janela > 0.3) tempo = Math.min(1.2, f.duracao / janela);
      f.inicioReal = +inicio.toFixed(3);
      f.tempo = +tempo.toFixed(3);
      f.duracaoReal = +(f.duracao / tempo).toFixed(3);
      if (tempo > 1.005 || inicio > f.inicio + 0.01) ajustadas++;
      fimAnterior = inicio + f.duracaoReal;
    });
    if (ajustadas) msgJob(job, `${ajustadas} fala(s) ajustada(s) para não sobrepor (aceleradas até 1,2× ou levemente adiadas).`);
    const fim = Math.max(p.ajustes.duracao, fimAnterior);
    const assinatura = assinaturaVoz(v);
    const nomeFaixa = `voz-${assinatura}.wav`;
    msgJob(job, 'Mixando as falas…');
    await montarFaixa(falas.map((f) => ({ arquivo: path.join(dir, f.arquivo), inicio: f.inicioReal, tempo: f.tempo })), fim, path.join(dir, nomeFaixa), { alvoLufs: -16 });
    const porTexto = new Map(falas.map((f) => [`${f.inicio}|${f.texto}`, f]));
    await gravarAudio(p.id, (au) => {
      au.voz.falas = au.voz.falas.map((f) => {
        const g = porTexto.get(`${f.inicio}|${f.texto}`);
        return g ? { ...f, arquivo: g.arquivo, duracao: g.duracao, inicioReal: g.inicioReal, tempo: g.tempo, duracaoReal: g.duracaoReal } : f;
      });
      au.voz.arquivo = nomeFaixa;
      au.voz.assinaturaGerada = assinatura;
    });
    msgJob(job, `Voz pronta (${falas.length} falas).`);
  }));

  // ---------------------------------------------------------------- sonoplastia cinematográfica
  /** Renderiza uma versão leve da animação e "assiste": cortes, movimento, flashes e folhas de quadros. */
  async function assistirVideo(job, p) {
    const dirAn = path.join(await pastaAudio(p.id), `analise-v${p.versaoAtual}`);
    const cache = path.join(dirAn, 'analise.json');
    if (existsSync(cache)) {
      const a = await lerJson(cache, null);
      if (a?.folhas?.every((f) => existsSync(path.join(dirAn, f)))) return { analise: a, dirAn };
    }
    await fs.mkdir(dirAn, { recursive: true });
    const { largura: W, altura: H, duracao } = p.ajustes;
    const k = 480 / Math.max(W, H);
    const lw = Math.round((W * k) / 2) * 2;
    const lh = Math.round((H * k) / 2) * 2;
    const video = path.join(dirAn, 'previa.mp4');
    msgJob(job, 'Assistindo ao vídeo (renderizando uma versão leve)…');
    await ctx.renderizarHtml({
      url: `${ctx.BASE}/p/${p.id}/?v=${p.versaoAtual}`, saida: video, largura: lw, altura: lh,
      layoutLargura: W, layoutAltura: H, fps: 10, duracao, qualidade: 28, sinal: job.controle.signal,
      progresso: (pr) => { if (pr != null) { job.progresso = pr * 0.4; job.ultima = `Assistindo ao vídeo… ${Math.round(pr * 100)}%`; } },
    });
    msgJob(job, 'Analisando cortes, movimento e luz…');
    const analise = await analisarVideo({ video, pasta: dirAn, duracao });
    await fs.rm(video, { force: true });
    await gravarJson(cache, analise);
    return { analise, dirAn };
  }

  /** IA assiste e planeja o desenho de som; grava no projeto. */
  async function planejar(job, p, modelo) {
    const a = estadoAudio(p);
    const e = a.efeitos;
    const biblioteca = e.motor === 'biblioteca' ? (await listarBiblioteca()).slice(0, 600) : [];
    if (e.motor === 'biblioteca' && !biblioteca.length) throw new Error('A biblioteca de efeitos está vazia. Importe sons primeiro.');
    const { analise, dirAn } = await assistirVideo(job, p);
    msgJob(job, `Vídeo analisado: ${analise.cortes.length} cortes, ${analise.picos.length} picos de movimento, ${analise.flashes.length} flashes. A IA está desenhando o som…`);
    job.progresso = 0.45;
    const falas = a.voz.ativo && a.voz.provedor !== 'arquivo' ? a.voz.falas.filter((f) => f.texto.trim()) : [];
    const gravacao = a.voz.ativo && a.voz.provedor === 'arquivo' ? a.voz.gravacao?.transcricao?.frases || [] : [];
    const plano = await planejarSonorizacao({
      html: await htmlAtual(p), ajustes: p.ajustes, analise, pastaFolhas: dirAn,
      falas: falas.length ? falas.map((f) => ({ inicio: f.inicioReal ?? f.inicio, duracao: f.duracaoReal ?? f.duracao, texto: f.texto })) : gravacao.map((f) => ({ inicio: f.inicio + (+a.voz.gravacao?.deslocamento || 0), duracao: f.fim - f.inicio, texto: f.texto })),
      estilo: e.estilo, intensidade: e.intensidade, comAmbiente: e.comAmbiente !== false, biblioteca,
      modelo, aoProgresso: progressoClaude(job), sinal: job.controle.signal,
    });
    const resumoAnalise = { duracao: analise.duracao, curva: analise.curva, cortes: analise.cortes, picos: analise.picos, flashes: analise.flashes };
    await gravarAudio(p.id, (au) => {
      au.efeitos.lista = plano.efeitos;
      au.efeitos.conceito = plano.conceito;
      au.efeitos.ambiente = plano.ambiente;
      au.efeitos.silencios = plano.silencios;
      au.efeitos.analise = resumoAnalise;
    });
    msgJob(job, `Plano pronto: ${plano.efeitos.length} sons${plano.ambiente ? ' + ambiência' : ''}.`);
    return plano;
  }

  app.post('/api/projetos/:id/audio/mapa', (req, res) => iniciarJobAudio(req, res, 'Assistindo ao vídeo e planejando o som', async (job, p) => {
    exigirVersao(p);
    await planejar(job, p, req.body?.modelo);
  }));

  app.post('/api/projetos/:id/audio/efeitos', (req, res) => iniciarJobAudio(req, res, 'Gerando a sonoplastia', async (job, p) => {
    exigirVersao(p);
    const cfg = await lerConfig();
    if (!estadoAudio(p).efeitos.lista.length) await planejar(job, p, req.body?.modelo);
    p = await lerProjeto(p.id);
    const e = estadoAudio(p).efeitos;
    const dir = await pastaAudio(p.id);
    const assinatura = assinaturaEfeitos(e);
    const nomeFaixa = `efeitos-${assinatura}.wav`;
    const saida = path.join(dir, nomeFaixa);
    const duracao = p.ajustes.duracao;

    if (e.motor === 'codigo') {
      msgJob(job, 'A IA está programando os sons (síntese)…');
      const script = await sintetizarPlanoEmCodigo({
        plano: e, duracao, comTrilha: e.comTrilha, estilo: e.estilo,
        modelo: req.body?.modelo, aoProgresso: progressoClaude(job), sinal: job.controle.signal,
      });
      await fs.writeFile(path.join(dir, `som-${assinatura}.js`), script, 'utf8');
      msgJob(job, 'Sintetizando o áudio…');
      await renderizarSomDeCodigo({ script, duracao, saida });
      await normalizarArquivo(saida, -20);
    } else {
      const ir = await garantirIR(path.join(DADOS, 'ir', 'sala-grande.wav'));
      const pastaEleven = path.join(PASTAS.sfx, 'elevenlabs');
      const pastaProc = path.join(dir, 'sfx');
      await fs.mkdir(pastaEleven, { recursive: true });
      await fs.mkdir(pastaProc, { recursive: true });
      const indiceArq = path.join(pastaProc, 'indice.json');
      const indice = await lerJson(indiceArq, {});

      /** fonte bruta do som (gera na ElevenLabs se preciso) */
      async function fonte(descricao, duracaoS, categoria, variante, { loop = false, arquivoBiblioteca } = {}) {
        if (e.motor === 'biblioteca') {
          const arq = arquivoBiblioteca && caminhoBiblioteca(arquivoBiblioteca);
          return arq && existsSync(arq) ? arq : null;
        }
        const arq = path.join(pastaEleven, `${slugify(descricao).slice(0, 40)}-${hash('sfx2', descricao, duracaoS, categoria, variante, loop, ...(ehTatil(categoria, descricao) ? ['asmr1'] : []))}.mp3`);
        if (!existsSync(arq)) {
          await efeitoEleven({ descricao: variante ? `${descricao} (variation ${variante + 1})` : descricao, duracao: duracaoS, saida: arq, chave: cfg.elevenlabsKey, categoria, loop });
        }
        return arq;
      }
      /** fonte tratada (pan, EQ, reverb) com cache */
      async function tratado(bruto, { categoria, descricao, pan, reverb, volume }) {
        // cliques, teclas, caneta, papel: tratamento "quase ASMR" (seco, macio, sem aspereza) em qualquer estilo
        const tatil = ehTatil(categoria, descricao);
        // 'trat2': sons tratados com o corte antigo (alguns ficaram vazios) são refeitos uma vez
        const nome = `${hash('trat2', bruto, categoria, pan, reverb, volume, ...(tatil ? ['tatil1'] : []))}.wav`;
        const arq = path.join(pastaProc, nome);
        if (!existsSync(arq) || !indice[nome]) {
          const r = await processarSom({ entrada: bruto, saida: arq, categoria, pan, reverb, volume, ir, tatil });
          indice[nome] = r.duracaoSeca;
        }
        return { arquivo: arq, nome, duracaoSeca: indice[nome], tatil };
      }

      const trechos = [];
      let semArquivo = 0;
      const lista = e.lista.map((x) => ({ ...x }));
      for (let i = 0; i < lista.length; i++) {
        if (job.controle.signal.aborted) throw new Error('Cancelado');
        const x = lista[i];
        job.progresso = 0.1 + (0.75 * i) / lista.length;
        job.ultima = `Som ${i + 1}/${lista.length}: ${x.categoria} — ${x.descricao.slice(0, 60)}`;
        const bruto = await fonte(x.descricao, x.duracao, x.categoria, x.variante || 0, { arquivoBiblioteca: x.arquivoBiblioteca });
        if (!bruto) { semArquivo++; x.gerado = null; continue; }
        const t = await tratado(bruto, x);
        trechos.push({ arquivo: t.arquivo, tatil: t.tatil, ...posicionar(x.inicio, x.alinhar, t.duracaoSeca) });
        x.gerado = t.nome;
        // camadas: mesmo instante e alinhamento, um pouco mais baixas
        for (const [k, c] of (x.camadas || []).entries()) {
          const bc = await fonte(c, x.duracao, x.categoria, (x.variante || 0) + k + 1, {});
          if (!bc) continue;
          const tc = await tratado(bc, { ...x, descricao: c, volume: (x.volume || 0.8) * 0.75 });
          trechos.push({ arquivo: tc.arquivo, tatil: tc.tatil, ...posicionar(x.inicio, x.alinhar, tc.duracaoSeca) });
        }
      }
      let ambiente = null;
      if (e.comAmbiente !== false && e.ambiente?.descricao && e.motor === 'elevenlabs') {
        job.ultima = 'Gerando a ambiência…';
        const bruto = await fonte(e.ambiente.descricao, Math.min(22, Math.max(6, duracao)), 'ambiente', e.ambiente.variante || 0, { loop: true });
        const t = await tratado(bruto, { categoria: 'ambiente', pan: 0, reverb: 0, volume: 1 });
        ambiente = { arquivo: t.arquivo, volume: e.ambiente.volume, silencios: e.silencios || [] };
      }
      await gravarJson(indiceArq, indice);
      if (!trechos.length && !ambiente) throw new Error('Nenhum efeito tem som associado. Escolha arquivos da biblioteca para os momentos.');
      if (semArquivo) msgJob(job, `${semArquivo} momento(s) sem som da biblioteca foram pulados.`);
      msgJob(job, `Mixando ${trechos.length} sons${ambiente ? ' + ambiência' : ''} (reverb, pan, compressão de bus)…`);
      job.progresso = 0.9;
      await mixarSonorizacao({ trechos, ambiente, duracao, saida, pastaTemp: PASTAS.temp });
      await gravarAudio(p.id, (au) => {
        // guarda qual arquivo tratado pertence a cada som (para ouvir um a um na tela)
        const porChave = new Map(lista.map((x) => [`${x.inicio}|${x.descricao}`, x.gerado]));
        au.efeitos.lista = au.efeitos.lista.map((x) => ({ ...x, gerado: porChave.get(`${x.inicio}|${x.descricao}`) ?? x.gerado ?? null }));
      });
    }
    await gravarAudio(p.id, (au) => { au.efeitos.arquivo = nomeFaixa; au.efeitos.assinaturaGerada = assinatura; });
    msgJob(job, 'Sonoplastia pronta.');
  }));

  // ouvir um som tratado isolado
  app.get('/p/:id/audio/sfx/:arquivo', (req, res) => {
    const arq = path.join(pastaProjeto(req.params.id), 'audio', 'sfx', path.basename(req.params.arquivo));
    if (!existsSync(arq)) return res.status(404).end();
    res.sendFile(arq);
  });

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

  // ---------------------------------------------------------------- estúdio de voz (aba 🎙 Voz)
  // roteiro corrido sobre o vídeo → voz inteira gerada de uma vez (soa natural) → "takes" → coloca no vídeo
  const locPadrao = () => ({
    briefing: '', tom: '', cta: '', publico: '', comTags: true, direcao: '', opcoes: [], texto: '',
    voz: '', vozNome: '', modelo: '', velocidade: 1, estabilidade: 0.5, similaridade: 0.8, estilo: 0.3, takes: [],
    // duração da fala: 'video' (cabe no vídeo), 'tempo' (segundos escolhidos) ou 'palavras' (até 1000)
    modoTempo: 'video', duracaoAlvo: 60, palavrasAlvo: 150,
  });
  const MAX_PALAVRAS = 1000;
  /** Quantas palavras e quantos segundos de fala o roteiro deve ter. */
  function alvoDaLocucao(l, duracaoVideo) {
    const ritmo = 2.3 * Math.min(1.2, Math.max(0.7, +l.velocidade || 1));
    const lim = (n) => Math.max(4, Math.min(MAX_PALAVRAS, Math.round(n)));
    const palavras = l.modoTempo === 'palavras' ? lim(+l.palavrasAlvo || 150)
      : l.modoTempo === 'tempo' ? lim((+l.duracaoAlvo || 60) * ritmo)
        : lim((duracaoVideo - 0.6) * ritmo);
    return { palavras, segundos: palavras / ritmo, livre: l.modoTempo !== 'video' };
  }
  // a ElevenLabs aceita ~5000 caracteres por pedido: textos longos vão em partes (por parágrafo/frase)
  function partirTexto(texto, max = 2500) {
    const partes = [];
    let atual = '';
    const blocos = texto.split(/\n+/).flatMap((b) => (b.length > max ? b.match(/[^.!?…]+[.!?…]*\s*/g) || [b] : [b]));
    for (const b of blocos) {
      if (atual && (atual + '\n' + b).length > max) { partes.push(atual.trim()); atual = ''; }
      atual += (atual ? '\n' : '') + b;
    }
    if (atual.trim()) partes.push(atual.trim());
    return partes;
  }
  const estadoLoc = (p) => ({ ...locPadrao(), ...(p.locucaoEstudio || {}) });
  async function gravarLoc(id, alterar) {
    const p = await lerProjeto(id);
    p.locucaoEstudio = estadoLoc(p);
    alterar(p.locucaoEstudio);
    await salvarProjeto(p);
    return p.locucaoEstudio;
  }
  const CAMPOS_LOC = ['briefing', 'tom', 'cta', 'publico', 'comTags', 'texto', 'voz', 'vozNome', 'modelo', 'velocidade', 'estabilidade', 'similaridade', 'estilo', 'modoTempo', 'duracaoAlvo', 'palavrasAlvo'];

  app.get('/api/projetos/:id/locucao', async (req, res) => {
    const p = await lerProjeto(req.params.id);
    if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
    res.json(estadoLoc(p));
  });
  app.put('/api/projetos/:id/locucao', async (req, res) => {
    const p = await lerProjeto(req.params.id);
    if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
    res.json(await gravarLoc(p.id, (l) => { for (const k of CAMPOS_LOC) if (req.body?.[k] !== undefined) l[k] = req.body[k]; }));
  });

  app.post('/api/projetos/:id/locucao/roteiro', (req, res) => iniciarJobAudio(req, res, 'Escrevendo o roteiro da voz', async (job, p) => {
    exigirVersao(p);
    const l = estadoLoc(p);
    const { analise, dirAn } = await assistirVideo(job, p);
    msgJob(job, 'A IA está assistindo ao vídeo e escrevendo 3 opções de roteiro…');
    const alvo = alvoDaLocucao(l, analise?.duracao || p.ajustes.duracao);
    const r = await escreverLocucao({
      alvoPalavras: alvo.palavras, duracaoFala: alvo.segundos, livre: alvo.livre,
      html: await htmlAtual(p), ajustes: p.ajustes, analise, pastaFolhas: dirAn,
      briefing: l.briefing, tom: l.tom, cta: l.cta, publico: l.publico, comTags: l.comTags, velocidade: l.velocidade,
      modelo: req.body?.modelo, aoProgresso: progressoClaude(job), sinal: job.controle.signal,
    });
    await gravarLoc(p.id, (x) => { x.direcao = r.direcao; x.opcoes = r.opcoes; x.alvoPalavras = r.alvoPalavras; if (!x.texto.trim()) x.texto = r.opcoes[0].texto; });
    msgJob(job, `${r.opcoes.length} opções de roteiro prontas.`);
  }));

  app.post('/api/projetos/:id/locucao/take', async (req, res) => {
    try {
      const p = await lerProjeto(req.params.id);
      if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
      const l = estadoLoc(p);
      const cfg = await lerConfig();
      if (!cfg.elevenlabsKey) return res.status(400).json({ erro: 'Cole a chave da ElevenLabs no ⚙ (topo da tela) primeiro.' });
      const texto = String(l.texto || '').trim();
      if (!texto) return res.status(400).json({ erro: 'Escreva ou gere o roteiro primeiro.' });
      if (texto.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).length > MAX_PALAVRAS + 50) return res.status(400).json({ erro: `Roteiro longo demais (máx. ${MAX_PALAVRAS} palavras).` });
      if (!l.voz) return res.status(400).json({ erro: 'Escolha uma voz.' });
      const dir = await pastaAudio(p.id);
      const nome = `take-${Date.now()}.mp3`;
      const partes = partirTexto(texto);
      const arquivos = [];
      for (let i = 0; i < partes.length; i++) {
        const saida = partes.length === 1 ? path.join(dir, nome) : path.join(PASTAS.temp, `${nome}-${i}.mp3`);
        await sintetizarFala({
          provedor: 'elevenlabs', voz: l.voz, modelo: l.modelo, velocidade: +l.velocidade || 1, texto: partes[i],
          // o trecho anterior/seguinte mantém a entonação contínua entre as partes
          anterior: partes[i - 1]?.slice(-600), proxima: partes[i + 1]?.slice(0, 600),
          idioma: idiomaDoProjeto(p), saida,
          ajustesVoz: { stability: +l.estabilidade, similarity_boost: +l.similaridade, style: +l.estilo },
        }, cfg);
        arquivos.push(saida);
      }
      if (arquivos.length > 1) {
        await juntarAudios(arquivos, path.join(dir, nome));
        await Promise.all(arquivos.map((a) => fs.rm(a, { force: true })));
      }
      const info = await sondar(path.join(dir, nome));
      const take = { arquivo: nome, duracao: info.duracao, criado: Date.now(), vozNome: l.vozNome || l.voz, modelo: l.modelo, texto };
      const salvo = await gravarLoc(p.id, (x) => {
        x.takes = [take, ...(x.takes || [])];
        for (const velho of x.takes.splice(12)) fs.rm(path.join(dir, velho.arquivo), { force: true }).catch(() => {});
      });
      res.json({ take, locucao: salvo });
    } catch (e) { res.status(400).json({ erro: e.message }); }
  });

  function juntarAudios(arquivos, saida) {
    const ent = arquivos.flatMap((a) => ['-i', a]);
    const filtro = arquivos.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono,apad=pad_dur=0.25[a${i}]`).join(';')
      + ';' + arquivos.map((_, i) => `[a${i}]`).join('') + `concat=n=${arquivos.length}:v=0:a=1[s]`;
    return new Promise((ok, falha) => {
      const pr = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...ent, '-filter_complex', filtro, '-map', '[s]', '-c:a', 'libmp3lame', '-b:a', '192k', saida], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      pr.stderr.on('data', (d) => { err += d; });
      pr.on('error', falha);
      pr.on('close', (c) => (c === 0 ? ok() : falha(new Error('ffmpeg: ' + err.slice(-400)))));
    });
  }

  // ---- encaixar um take no tempo do vídeo: transcreve, corta em frases e a IA posiciona cada frase na cena certa
  /** Junta as palavras transcritas em blocos (frases): quebra em ponto final/!/?/… ou pausa longa. */
  function blocosDaFala(t) {
    const blocos = [];
    let atual = null;
    for (const w of t.palavras || []) {
      if (atual && w.inicio - atual.fim > 0.6) { blocos.push(atual); atual = null; }
      if (!atual) atual = { ini: w.inicio, fim: w.fim, palavras: [] };
      atual.palavras.push(w.p);
      atual.fim = w.fim;
      if (/[.!?…]$/.test(w.p) && atual.palavras.length >= 2) { blocos.push(atual); atual = null; }
    }
    if (atual) blocos.push(atual);
    // margens: um pouco antes do 1º fonema e a cauda depois da última palavra, sem invadir o próximo bloco
    return blocos.map((b, i) => {
      const ini = Math.max(0, b.ini - 0.06);
      const prox = blocos[i + 1]?.ini ?? (t.duracao || b.fim + 0.3);
      const fim = Math.min(prox - 0.02, b.fim + 0.18);
      return { i, ini: +ini.toFixed(3), dur: +(fim - ini).toFixed(3), texto: b.palavras.join(' ') };
    });
  }

  /** Garante ordem, sem sobreposição e dentro do vídeo; se faltar espaço, encosta os blocos. */
  function arrumarPosicoes(blocos, inicios, duracao) {
    const RESPIRO = 0.15;
    const pos = blocos.map((b, i) => (Number.isFinite(inicios[i]) ? Math.max(0, inicios[i]) : NaN));
    // sem resposta da IA para algum bloco: distribui o espaço livre igualmente
    if (pos.some((x) => !Number.isFinite(x))) {
      const livre = Math.max(0, duracao - 0.3 - blocos.reduce((s, b) => s + b.dur, 0));
      const gap = livre / (blocos.length + 1);
      let t = Math.min(0.4, gap);
      blocos.forEach((b, i) => { pos[i] = t; t += b.dur + Math.max(RESPIRO, gap); });
    }
    for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + blocos[i - 1].dur + RESPIRO);
    // passou do fim: puxa de trás para frente
    const limite = duracao - 0.2;
    let fimMax = limite;
    for (let i = pos.length - 1; i >= 0; i--) {
      if (pos[i] + blocos[i].dur > fimMax) pos[i] = fimMax - blocos[i].dur;
      fimMax = pos[i] - RESPIRO;
    }
    return pos.map((x) => +Math.max(0, x).toFixed(3));
  }

  app.post('/api/projetos/:id/locucao/encaixar', (req, res) => iniciarJobAudio(req, res, 'Encaixando a voz no vídeo', async (job, p) => {
    exigirVersao(p);
    const arq = path.basename(String(req.body?.arquivo || ''));
    const dir = await pastaAudio(p.id);
    const origem = path.join(dir, arq);
    if (!/^take-[\w-]+\.mp3$/.test(arq) || !existsSync(origem)) throw new Error('Take não encontrado.');
    const l = estadoLoc(p);
    const take = (l.takes || []).find((t) => t.arquivo === arq);
    job.ultima = 'Ouvindo a voz e marcando onde cada frase começa (Whisper)…';
    // sem "dica" com o próprio texto: o Whisper costuma pular a primeira frase quando recebe o roteiro como prompt
    const t = await transcrever({ arquivo: origem, pastaTemp: PASTAS.temp, sinal: job.controle.signal });
    const blocos = blocosDaFala(t);
    if (!blocos.length) throw new Error('Não encontrei fala nesse take.');
    const total = blocos.reduce((s, b) => s + b.dur, 0);
    const duracao = p.ajustes.duracao;
    if (total > duracao - 0.2) throw new Error(`A fala tem ${total.toFixed(1)}s e o vídeo ${duracao}s: não cabe. Use “Sincronizar a animação com a voz” (o vídeo ganha o tempo da fala) ou gere um roteiro mais curto.`);
    const { analise, dirAn } = await assistirVideo(job, p);
    msgJob(job, `A IA está assistindo ao vídeo e posicionando ${blocos.length} frases…`);
    let inicios = [];
    try {
      const r = await encaixarFalas({
        html: await htmlAtual(p), ajustes: p.ajustes, analise, pastaFolhas: dirAn,
        blocos: blocos.map(({ i, dur, texto }) => ({ i, dur, texto })),
        modelo: req.body?.modelo, aoProgresso: progressoClaude(job), sinal: job.controle.signal,
      });
      for (const x of r) inicios[x.i] = x.inicio;
    } catch (e) {
      if (job.controle.signal.aborted) throw e;
      msgJob(job, 'A IA não respondeu; distribuindo as frases pelo vídeo de forma uniforme.');
      inicios = [];
    }
    const pos = arrumarPosicoes(blocos, inicios, duracao);
    const nome = `take-${Date.now()}-encaixe.mp3`;
    job.ultima = 'Montando a voz encaixada…';
    await montarFaixa(blocos.map((b, i) => ({ arquivo: origem, inicio: pos[i], cortarInicio: b.ini, duracao: b.dur })), duracao, path.join(dir, nome));
    const info = await sondar(path.join(dir, nome));
    const novo = {
      arquivo: nome, duracao: info.duracao, criado: Date.now(), vozNome: take?.vozNome || '', modelo: take?.modelo || '',
      texto: take?.texto || t.texto, encaixeDe: arq,
      blocos: blocos.map((b, i) => ({ inicio: pos[i], dur: b.dur, texto: b.texto })),
    };
    await gravarLoc(p.id, (x) => { x.takes = [novo, ...(x.takes || [])]; });
    msgJob(job, `Voz encaixada: ${blocos.length} frases distribuídas nos ${duracao}s do vídeo.`);
  }));

  app.delete('/api/projetos/:id/locucao/take/:arquivo', async (req, res) => {
    const arq = path.basename(req.params.arquivo);
    const dir = await pastaAudio(req.params.id);
    const salvo = await gravarLoc(req.params.id, (x) => { x.takes = (x.takes || []).filter((t) => t.arquivo !== arq); });
    if (/^take-[\w-]+\.mp3$/.test(arq)) await fs.rm(path.join(dir, arq), { force: true });
    res.json(salvo);
  });

  // usa um take como a voz do projeto: vira "Meu áudio gravado" (transcrito com o tempo de cada palavra)
  app.post('/api/projetos/:id/locucao/usar', async (req, res) => {
    const p = await lerProjeto(req.params.id);
    if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
    const arq = path.basename(String(req.body?.arquivo || ''));
    const dir = await pastaAudio(p.id);
    if (!/^take-[\w-]+\.mp3$/.test(arq) || !existsSync(path.join(dir, arq))) return res.status(400).json({ erro: 'Take não encontrado.' });
    const nome = `gravacao-${Date.now()}.mp3`;
    await fs.copyFile(path.join(dir, arq), path.join(dir, nome));
    const info = await sondar(path.join(dir, nome));
    await gravarAudio(p.id, (au) => {
      au.voz.provedor = 'arquivo';
      au.voz.ativo = true;
      au.voz.gravacao = { arquivo: nome, nomeOriginal: `Voz do estúdio (${arq})`, duracao: info.duracao, deslocamento: +req.body?.atraso || 0, transcricao: null };
    });
    iniciarJobAudio(req, res, 'Colocando a voz no vídeo', (job) => transcreverGravacao(job, p.id));
  });

  app.get('/api/projetos/:id/audio/job', (req, res) => {
    const j = jobsAudio.get(req.params.id);
    res.json(j ? jobPublico(j) : null);
  });

  return { anexarLocucao, locucaoDoProjeto };
}
