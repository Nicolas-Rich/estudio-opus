// Estúdio de Vídeo Opus — servidor local.
// Biblioteca dos modelos do awesome-opus5-5-videos → geração com Claude →
// render HTML→MP4 → editor de timeline (ffmpeg).
import express from 'express';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarComClaude, montarPedido, montarRefino, montarSincronia, MODELOS_CLAUDE, versaoClaude } from './lib/claude.js';
import { renderizarHtml, capturarQuadro } from './lib/render.js';
import { sondar, miniatura, exportarTimeline, FFMPEG as FFMPEG_BIN } from './lib/ffmpeg.js';
import { registrarRotasAudio, estadoAudio, faixasDoProjeto } from './lib/rotas-audio.js';
import { aplicarAudioNoVideo } from './lib/audio.js';
import { exportarEdicao } from './lib/montagem.js';
import { transcrever } from './lib/transcricao.js';
import { gerarPromptDeIdeia, sugerirExtras, escreverPromptDoVideo } from './lib/assistente.js';
import { analisarVideo } from './lib/analise-video.js';
import { comporSobreVideo, sondarVideo } from './lib/sobre-video.js';
import { MODELOS_CODEX, versaoCodex } from './lib/codex.js';
import { registrarRotasKie } from './lib/rotas-kie.js';
import { registrarRotasGerador } from './lib/rotas-gerador.js';
import { consertarHtml } from './lib/checar-html.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(RAIZ, 'awesome-opus5-5-videos');
const DADOS = path.join(RAIZ, 'dados');
const PASTAS = {
  projetos: path.join(DADOS, 'projetos'),
  midia: path.join(DADOS, 'midia'),
  miniaturas: path.join(DADOS, 'miniaturas'),
  posters: path.join(DADOS, 'posters'),
  temp: path.join(DADOS, 'temp'),
  sfx: path.join(DADOS, 'biblioteca-sfx'),
  vozes: path.join(DADOS, 'vozes'),
};
const PORTA = Number(process.env.PORT) || 4777;
const BASE = `http://127.0.0.1:${PORTA}`;

for (const p of Object.values(PASTAS)) await fs.mkdir(p, { recursive: true });

// ---------------------------------------------------------------- utilidades
const lerJson = async (arq, padrao) => {
  try { return JSON.parse(await fs.readFile(arq, 'utf8')); } catch { return padrao; }
};
const gravarJson = (arq, obj) => fs.writeFile(arq, JSON.stringify(obj, null, 2), 'utf8');
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';
const idValido = (id) => /^[a-z0-9-]{4,60}$/i.test(id);

// ---------------------------------------------------------------- modelos (repo)
const CATEGORIAS = {
  motion: 'Motion graphics',
  explainer: 'Explicativos',
  '3d': 'Cenas 3D',
  interactive: 'Jogos e interativos',
};
let modelos = [];
let modelosPorSlug = new Map();
async function carregarModelos() {
  modelos = await lerJson(path.join(REPO, 'data', 'videos.json'), []);
  modelosPorSlug = new Map(modelos.map((m) => [m.slug, m]));
  console.log(`  ${modelos.length} modelos carregados do repositório.`);
}
// primeira execução: baixa a biblioteca de modelos (prompts) do GitHub
const URL_REPO_MODELOS = 'https://github.com/yihui-dev/awesome-opus5-5-videos.git';
if (!existsSync(path.join(REPO, 'data', 'videos.json'))) {
  console.log('  Baixando a biblioteca de modelos (só na primeira vez)…');
  const r = spawnSync('git', ['clone', '--depth', '1', URL_REPO_MODELOS, REPO], { stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.warn('  Não consegui baixar os modelos. Instale o Git (https://git-scm.com) ou baixe o ZIP de');
    console.warn(`  ${URL_REPO_MODELOS.replace('.git', '')} e extraia na pasta "awesome-opus5-5-videos".`);
  }
}
await carregarModelos();

// ---------------------------------------------------------------- jobs
const jobs = new Map();
function criarJob(tipo, extra = {}) {
  const job = { id: novoId(), tipo, status: 'fila', progresso: 0, mensagens: [], criado: Date.now(), ...extra };
  job.controle = new AbortController();
  jobs.set(job.id, job);
  return job;
}
const msgJob = (job, m) => {
  if (!m) return;
  job.mensagens.push({ t: Date.now(), m });
  if (job.mensagens.length > 200) job.mensagens.shift();
  job.ultima = m;
};
const jobPublico = ({ controle, ...j }) => j;
// renders e exportações são pesados: um de cada vez
let filaPesada = Promise.resolve();
const naFila = (fn) => (filaPesada = filaPesada.then(fn, fn));

// ---------------------------------------------------------------- mídia
const INDICE_MIDIA = path.join(DADOS, 'midia.json');
let midias = await lerJson(INDICE_MIDIA, []);
const salvarMidias = () => gravarJson(INDICE_MIDIA, midias);

async function registrarMidia(arquivo, extra = {}) {
  const nome = path.basename(arquivo);
  const info = await sondar(arquivo);
  let thumb = null;
  try {
    const t = path.join(PASTAS.miniaturas, nome + '.jpg');
    if (info.tipo === 'video') await miniatura(arquivo, t, Math.min(1, info.duracao / 3));
    if (info.tipo === 'imagem') await miniatura(arquivo, t, 0);
    if (info.tipo !== 'audio') thumb = path.basename(t);
  } catch {}
  const item = { nome, ...info, thumb, criado: Date.now(), origem: 'upload', ...extra };
  midias = midias.filter((m) => m.nome !== nome);
  midias.unshift(item);
  await salvarMidias();
  return item;
}

async function nomeLivre(pasta, base, ext) {
  let n = `${base}${ext}`;
  for (let i = 2; existsSync(path.join(pasta, n)); i++) n = `${base}-${i}${ext}`;
  return n;
}

// ---------------------------------------------------------------- projetos
const pastaProjeto = (id) => path.join(PASTAS.projetos, id);
const lerProjeto = (id) => lerJson(path.join(pastaProjeto(id), 'projeto.json'), null);
const salvarProjeto = (p) => { p.atualizado = Date.now(); return gravarJson(path.join(pastaProjeto(p.id), 'projeto.json'), p); };

// projetos que estavam gerando quando o servidor caiu
for (const id of await fs.readdir(PASTAS.projetos).catch(() => [])) {
  const p = await lerProjeto(id);
  if (p && p.status === 'gerando') {
    p.status = p.versoes?.length ? 'pronto' : 'erro';
    p.erro = p.versoes?.length
      ? 'A última geração/refino foi interrompida porque o estúdio foi fechado no meio. A versão anterior continua aqui; peça de novo se quiser.'
      : 'O estúdio foi fechado durante a geração. Clique em “Gerar de novo” (aba Prompt).';
    await salvarProjeto(p);
  }
}

async function gerarCapa(p) {
  try {
    const escala = 360 / Math.max(p.ajustes.largura, p.ajustes.altura);
    await capturarQuadro({
      url: `${BASE}/p/${p.id}/`,
      largura: Math.round(p.ajustes.largura * escala),
      altura: Math.round(p.ajustes.altura * escala),
      segundo: Math.min(2.5, p.ajustes.duracao / 2),
      saida: path.join(pastaProjeto(p.id), 'capa.jpg'),
    });
    p.capa = Date.now();
    await salvarProjeto(p);
  } catch (e) {
    console.warn('capa falhou:', e.message);
  }
}

function iniciarGeracao(p, pedido, origem, instrucao) {
  const job = criarJob('geracao', { projetoId: p.id });
  p.status = 'gerando';
  p.jobId = job.id;
  p.erro = null;
  salvarProjeto(p);
  job.status = 'rodando';
  msgJob(job, 'Enviando o pedido para o Claude…');
  const t0 = Date.now();
  gerarComClaude({
    pedido,
    modelo: p.modelo,
    pastaImagens: p.imagens?.length ? path.join(pastaProjeto(p.id), 'assets') : undefined,
    sinal: job.controle.signal,
    aoProgresso: (chars, msg) => {
      if (msg) msgJob(job, msg);
      if (chars) {
        job.caracteres = chars;
        job.ultima = `Escrevendo o código… ${(chars / 1000).toFixed(1)}k caracteres · ${Math.round((Date.now() - t0) / 1000)}s`;
      }
    },
  }).then(async (r) => {
    const atual = (await lerProjeto(p.id)) || p;
    const n = (atual.versoes?.length || 0) + 1;
    const conferido = consertarHtml(r.html);
    if (conferido.trocas) msgJob(job, `Corrigi ${conferido.trocas} erro(s) de sintaxe no código (sinal antes de potência).`);
    if (conferido.erros.length) msgJob(job, `⚠ O código tem erro de JavaScript e pode ficar em tela preta: ${conferido.erros[0]}. Use "Refinar" pedindo para corrigir.`);
    await fs.writeFile(path.join(pastaProjeto(p.id), `v${n}.html`), conferido.html, 'utf8');
    atual.versoes = [...(atual.versoes || []), { n, criado: Date.now(), origem, instrucao: instrucao || null, custo: r.custo ?? null }];
    atual.versaoAtual = n;
    atual.status = 'pronto';
    atual.jobId = null;
    await salvarProjeto(atual);
    job.status = 'ok';
    job.progresso = 1;
    msgJob(job, `Pronto em ${Math.round((Date.now() - t0) / 1000)}s (versão ${n}).`);
    gerarCapa(atual);
  }).catch(async (e) => {
    // guarda a resposta bruta para dar para recuperar à mão se precisar
    if (e.texto) await fs.writeFile(path.join(pastaProjeto(p.id), `resposta-falha-${Date.now()}.txt`), e.texto, 'utf8').catch(() => {});
    const atual = (await lerProjeto(p.id)) || p;
    atual.status = atual.versoes?.length ? 'pronto' : 'erro';
    atual.erro = e.message;
    atual.jobId = null;
    await salvarProjeto(atual);
    job.status = 'erro';
    job.erro = e.message;
    msgJob(job, 'Erro: ' + e.message);
  });
  return job;
}

// ---------------------------------------------------------------- app
const app = express();
let audioHooks; // preenchido por registrarRotasAudio (locução gravada)
app.disable('x-powered-by');

app.use('/', express.static(path.join(RAIZ, 'public')));
app.use('/arquivos/midia', express.static(PASTAS.midia));
app.use('/arquivos/miniaturas', express.static(PASTAS.miniaturas));

// upload: corpo cru (sem limite de tamanho), antes do parser JSON
app.post('/api/midia/upload', async (req, res) => {
  const original = String(req.query.nome || 'arquivo');
  const ext = path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
  const nome = await nomeLivre(PASTAS.midia, slugify(path.basename(original, path.extname(original))), ext);
  const destino = path.join(PASTAS.midia, nome);
  const ws = createWriteStream(destino);
  req.pipe(ws);
  ws.on('finish', async () => res.json(await registrarMidia(destino, { origem: 'upload', titulo: original })));
  ws.on('error', (e) => res.status(500).json({ erro: e.message }));
});

app.use(express.json({ limit: '20mb' }));

app.get('/api/status', async (_req, res) => {
  const codex = await versaoCodex();
  res.json({ claude: await versaoClaude(), codex, modelosClaude: [...MODELOS_CLAUDE, ...(codex ? MODELOS_CODEX : [])], totalModelos: modelos.length });
});

app.get('/api/modelos', (_req, res) => {
  res.json({
    categorias: CATEGORIAS,
    modelos: modelos.map((m) => ({
      slug: m.slug, autor: m.author, post: m.post_url, categoria: m.category, tags: m.tech_tags,
      prompt: m.prompt, parcial: m.prompt_partial, skillry: m.skillry_url, adicionado: m.added,
    })),
  });
});

app.post('/api/modelos/atualizar', (_req, res) => {
  const p = spawn('git', ['-C', REPO, 'pull', '--ff-only'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('error', (e) => res.status(500).json({ erro: e.message }));
  p.on('close', async (code) => {
    await carregarModelos();
    res.status(code === 0 ? 200 : 500).json({ saida: out.trim(), total: modelos.length });
  });
});

// assistente de criação: ideia → prompt completo / sugestão de instruções extras
app.post('/api/assistente', async (req, res) => {
  const { tipo, ideia = '', prompt = '', ideiaExtra = '', slug, ajustes = {}, modelo } = req.body || {};
  try {
    if (tipo === 'extras') {
      return res.json({ texto: await sugerirExtras({ prompt, ideiaExtra, ajustes, modelo: modelo || 'claude-sonnet-5-5' }) });
    }
    const base = slug ? modelosPorSlug.get(slug) : null;
    // referências: 2 prompts completos e de tamanho médio, de preferência da mesma categoria
    const candidatos = modelos.filter((m) => !m.prompt_partial && m.slug !== slug && m.prompt.length > 400 && m.prompt.length < 1800);
    const mesmos = candidatos.filter((m) => !base || m.category === base.category);
    const pool = mesmos.length >= 2 ? mesmos : candidatos;
    const referencias = [...pool].sort(() => Math.random() - 0.5).slice(0, 2).map((m) => m.prompt);
    // pasta só deste pedido, com as imagens dele (+ quadro do vídeo original do modelo)
    const pastaAssist = path.join(PASTAS.temp, `assist-${novoId()}`);
    const imgsAssist = await moverImagens(req.body?.imagens, pastaAssist);
    if (req.body?.videoRef) imgsAssist.push(...await quadrosDaReferencia(req.body.videoRef, pastaAssist));
    else if (base) { const o = await quadroOriginal(base.slug, pastaAssist); if (o) imgsAssist.push(o); }
    const texto = await gerarPromptDeIdeia({
      ideia, ajustes, modeloBase: base?.prompt, referencias, modelo: modelo || 'claude-sonnet-5-5',
      imagens: imgsAssist, pastaImagens: imgsAssist.length ? pastaAssist : undefined,
    });
    fs.rm(pastaAssist, { recursive: true, force: true }).catch(() => {});
    res.json({ texto });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// "animação por cima do meu vídeo": analisa o vídeo (o que a pessoa fala + quadros) e escreve o prompt.
// Guarda no mesmo formato da locução gravada, para a criação do projeto sincronizar a animação com a fala.
app.post('/api/video-base', async (req, res) => {
  const original = path.basename(String(req.query.nome || 'video.mp4'));
  const ext = path.extname(original).toLowerCase();
  if (!EXT_VIDEO.test(ext) || ext === '.gif') return res.status(400).json({ erro: 'Envie um arquivo de vídeo (MP4, MOV, WEBM…).' });
  const base = `locucao-${Date.now().toString(36)}`;
  const arq = path.join(PASTAS.temp, base + ext);
  await new Promise((ok, falha) => { const ws = createWriteStream(arq); req.pipe(ws); ws.on('finish', ok); ws.on('error', falha); });
  const info = await sondarVideo(arq);
  if (!info?.largura || !info.duracao) {
    await fs.rm(arq, { force: true });
    return res.status(400).json({ erro: 'Não consegui ler esse vídeo.' });
  }
  if (!info.temAudio) {
    await fs.rm(arq, { force: true });
    return res.status(400).json({ erro: 'Esse vídeo não tem áudio: a animação é construída a partir do que você fala.' });
  }
  const ideia = String(req.query.ideia || '').slice(0, 2000);
  const job = criarJob('assistente', { rotulo: 'Analisando o seu vídeo' });
  job.status = 'rodando';
  res.json({ job: jobPublico(job) });
  const pastaQuadros = path.join(PASTAS.temp, base + '-quadros');
  try {
    msgJob(job, 'Lendo o que você fala (Whisper, no seu PC)…');
    const t = await transcrever({ arquivo: arq, pastaTemp: PASTAS.temp, dica: ideia.slice(0, 300), sinal: job.controle.signal });
    if (!t.palavras.length) throw new Error('Não encontrei fala no vídeo.');
    job.progresso = 0.4;
    msgJob(job, 'Olhando os quadros do vídeo…');
    const { folhas } = await analisarVideo({ video: arq, pasta: pastaQuadros, duracao: info.duracao });
    job.progresso = 0.55;
    msgJob(job, 'O Claude está assistindo ao vídeo e escrevendo o prompt…');
    const prompt = await escreverPromptDoVideo({
      transcricao: t, folhas, largura: info.largura, altura: info.altura, duracao: info.duracao, ideia,
      modelo: String(req.query.modelo || '') || 'claude-sonnet-5-5', pastaImagens: pastaQuadros, sinal: job.controle.signal,
    });
    await gravarJson(path.join(PASTAS.temp, base + '.json'), {
      arquivo: base + ext, nomeOriginal: original, transcricao: t,
      video: { largura: info.largura, altura: info.altura, duracao: info.duracao },
    });
    job.resultado = { locucao: base, prompt, largura: info.largura, altura: info.altura, duracao: info.duracao };
    job.status = 'ok';
    job.progresso = 1;
    msgJob(job, 'Prompt pronto.');
  } catch (e) {
    job.status = 'erro';
    job.erro = e.message;
    await fs.rm(arq, { force: true });
  } finally {
    fs.rm(pastaQuadros, { recursive: true, force: true }).catch(() => {});
  }
});

// pôster do modelo: baixa uma vez do CDN do Skillry e guarda em dados/posters
app.get('/poster/:slug', async (req, res) => {
  const m = modelosPorSlug.get(req.params.slug);
  if (!m) return res.status(404).end();
  const arq = path.join(PASTAS.posters, m.slug + '.webp');
  if (!existsSync(arq)) {
    try {
      const r = await fetch(m.poster_url);
      if (!r.ok) throw new Error(String(r.status));
      await fs.writeFile(arq, Buffer.from(await r.arrayBuffer()));
    } catch {
      return res.status(404).end();
    }
  }
  res.set('Cache-Control', 'public, max-age=604800');
  res.sendFile(arq);
});

// ---- projetos
app.get('/api/projetos', async (_req, res) => {
  const ids = await fs.readdir(PASTAS.projetos).catch(() => []);
  const lista = (await Promise.all(ids.map(lerProjeto))).filter(Boolean);
  lista.sort((a, b) => b.atualizado - a.atualizado);
  res.json(lista);
});

app.get('/api/projetos/:id', async (req, res) => {
  if (!idValido(req.params.id)) return res.status(400).end();
  const p = await lerProjeto(req.params.id);
  if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
  res.json({ ...p, audio: estadoAudio(p), job: p.jobId && jobs.has(p.jobId) ? jobPublico(jobs.get(p.jobId)) : null });
});

app.post('/api/projetos', async (req, res) => {
  const { slug, prompt, ajustes, modelo, nome, locucao: locucaoEnviada, imagens: imagensEnviadas, videoFundo } = req.body || {};
  if (videoFundo && videoFundo !== locucaoEnviada) return res.status(400).json({ erro: 'Vídeo de fundo inválido.' });
  if (!prompt || !ajustes?.largura || !ajustes?.altura || !ajustes?.duracao) {
    return res.status(400).json({ erro: 'Faltam prompt, formato ou duração.' });
  }
  const m = slug ? modelosPorSlug.get(slug) : null;
  const id = `${slugify(nome || ajustes.tema || m?.author || 'projeto')}-${novoId()}`;
  await fs.mkdir(pastaProjeto(id), { recursive: true });
  const p = {
    id,
    nome: nome || (ajustes.tema ? ajustes.tema.slice(0, 60) : `Modelo @${m?.author || 'livre'}`),
    slug: slug || null,
    autor: m?.author || null,
    prompt,
    ajustes,
    modelo: modelo || MODELOS_CLAUDE[0].id,
    status: 'gerando',
    versoes: [],
    versaoAtual: 0,
    renders: [],
    criado: Date.now(),
  };
  await salvarProjeto(p);
  let locucao = null;
  let projeto = p;
  // o vídeo enviado fica por baixo da animação (copiado antes de a locução mover o arquivo)
  if (videoFundo) {
    const meta = /^locucao-[a-z0-9]+$/.test(videoFundo) ? await lerJson(path.join(PASTAS.temp, videoFundo + '.json'), null) : null;
    if (!meta?.video) {
      await fs.rm(pastaProjeto(id), { recursive: true, force: true });
      return res.status(400).json({ erro: 'O vídeo enviado não foi encontrado (analise o vídeo de novo).' });
    }
    const dirAssets = path.join(pastaProjeto(id), 'assets');
    await fs.mkdir(dirAssets, { recursive: true });
    const nomeFundo = 'fundo' + path.extname(meta.arquivo);
    await fs.copyFile(path.join(PASTAS.temp, meta.arquivo), path.join(dirAssets, nomeFundo));
    p.videoFundo = { arquivo: nomeFundo, ...meta.video };
    p.ajustes.sobreVideo = true;
    await salvarProjeto(p);
  }
  if (locucaoEnviada) {
    try {
      const l = await audioHooks.anexarLocucao(p, locucaoEnviada);
      locucao = l.locucao;
      // relê do disco: anexarLocucao gravou a faixa de voz no projeto
      projeto = await lerProjeto(id);
      projeto.ajustes.duracao = projeto.videoFundo ? Math.round(projeto.videoFundo.duracao * 10) / 10 : Math.ceil((l.duracao + 0.4) * 10) / 10;
    } catch (e) {
      await fs.rm(pastaProjeto(id), { recursive: true, force: true });
      return res.status(400).json({ erro: e.message });
    }
  }
  if (Array.isArray(imagensEnviadas) && imagensEnviadas.length) {
    projeto.imagens = await moverImagens(imagensEnviadas, path.join(pastaProjeto(id), 'assets'));
  }
  // partindo de um modelo: o quadro do vídeo original vai como referência de fidelidade
  if (req.body?.videoRef) {
    const qs = await quadrosDaReferencia(req.body.videoRef, path.join(pastaProjeto(id), 'assets'));
    if (qs.length) projeto.imagens = [...(projeto.imagens || []), ...qs];
  } else if (slug && req.body?.fiel !== false) {
    const orig = await quadroOriginal(slug, path.join(pastaProjeto(id), 'assets'));
    if (orig) projeto.imagens = [...(projeto.imagens || []), orig];
  }
  if (projeto.imagens?.length) await salvarProjeto(projeto);
  const job = iniciarGeracao(projeto, montarPedido({ prompt, ajustes: projeto.ajustes, locucao, imagens: projeto.imagens }), 'gerado');
  res.json({ projeto, job: jobPublico(job) });
});

app.post('/api/projetos/:id/refinar', async (req, res) => {
  const p = await lerProjeto(req.params.id);
  if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
  if (p.status === 'gerando') return res.status(409).json({ erro: 'Já existe uma geração em andamento.' });
  const instrucao = String(req.body?.instrucao || '').trim();
  if (!instrucao) return res.status(400).json({ erro: 'Escreva o que mudar.' });
  if (req.body?.modelo) p.modelo = req.body.modelo;
  let pedido;
  if (p.versaoAtual) {
    const htmlAtual = await fs.readFile(path.join(pastaProjeto(p.id), `v${p.versaoAtual}.html`), 'utf8');
    pedido = montarRefino({ htmlAtual, instrucao, ajustes: p.ajustes, locucao: audioHooks.locucaoDoProjeto(p), imagens: p.imagens });
  } else {
    pedido = montarPedido({ prompt: p.prompt, ajustes: { ...p.ajustes, extra: [p.ajustes.extra, instrucao].filter(Boolean).join(' · ') } });
  }
  const job = iniciarGeracao(p, pedido, 'refino', instrucao);
  res.json({ job: jobPublico(job) });
});

app.post('/api/projetos/:id/regerar', async (req, res) => {
  const p = await lerProjeto(req.params.id);
  if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
  if (p.status === 'gerando') return res.status(409).json({ erro: 'Já existe uma geração em andamento.' });
  if (req.body?.modelo) p.modelo = req.body.modelo;
  const job = iniciarGeracao(p, montarPedido({ prompt: p.prompt, ajustes: p.ajustes, locucao: audioHooks.locucaoDoProjeto(p), imagens: p.imagens }), 'gerado');
  res.json({ job: jobPublico(job) });
});

app.post('/api/projetos/:id/cancelar', async (req, res) => {
  const p = await lerProjeto(req.params.id);
  const job = p?.jobId && jobs.get(p.jobId);
  if (job) job.controle.abort();
  res.json({ ok: !!job });
});

app.get('/api/projetos/:id/html', async (req, res) => {
  const p = await lerProjeto(req.params.id);
  if (!p?.versaoAtual) return res.status(404).json({ erro: 'Sem versão' });
  const n = Number(req.query.v) || p.versaoAtual;
  res.type('text/plain').send(await fs.readFile(path.join(pastaProjeto(p.id), `v${n}.html`), 'utf8'));
});

app.put('/api/projetos/:id/html', async (req, res) => {
  const p = await lerProjeto(req.params.id);
  if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
  const html = String(req.body?.html || '');
  if (!html.trim()) return res.status(400).json({ erro: 'HTML vazio' });
  const n = (p.versoes?.length || 0) + 1;
  await fs.writeFile(path.join(pastaProjeto(p.id), `v${n}.html`), html, 'utf8');
  p.versoes.push({ n, criado: Date.now(), origem: 'manual', instrucao: 'Edição manual do código' });
  p.versaoAtual = n;
  p.status = 'pronto';
  await salvarProjeto(p);
  gerarCapa(p);
  res.json(p);
});

app.patch('/api/projetos/:id', async (req, res) => {
  const p = await lerProjeto(req.params.id);
  if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
  const { nome, versaoAtual, ajustes } = req.body || {};
  if (nome) p.nome = String(nome).slice(0, 80);
  if (versaoAtual && p.versoes.some((v) => v.n === versaoAtual)) p.versaoAtual = versaoAtual;
  if (ajustes) p.ajustes = { ...p.ajustes, ...ajustes };
  await salvarProjeto(p);
  if (versaoAtual) gerarCapa(p);
  res.json(p);
});

app.delete('/api/projetos/:id', async (req, res) => {
  if (!idValido(req.params.id)) return res.status(400).end();
  await fs.rm(pastaProjeto(req.params.id), { recursive: true, force: true });
  res.json({ ok: true });
});

app.get('/api/projetos/:id/capa', async (req, res) => {
  if (!idValido(req.params.id)) return res.status(400).end();
  const arq = path.join(pastaProjeto(req.params.id), 'capa.jpg');
  if (!existsSync(arq)) return res.status(404).end();
  res.sendFile(arq);
});

// a animação em si (iframe de pré-visualização e fonte do render)
/** Copia um quadro do vídeo original do modelo (pôster) como PNG para a pasta indicada. */
async function quadroOriginal(slug, destinoDir, nomeArquivo = 'modelo-original.png') {
  const m = modelosPorSlug.get(slug);
  if (!m) return null;
  const webp = path.join(PASTAS.posters, m.slug + '.webp');
  try {
    if (!existsSync(webp)) {
      const r = await fetch(m.poster_url);
      if (!r.ok) return null;
      await fs.writeFile(webp, Buffer.from(await r.arrayBuffer()));
    }
    await fs.mkdir(destinoDir, { recursive: true });
    const png = path.join(destinoDir, nomeArquivo);
    await new Promise((ok, falha) => {
      const p = spawn(FFMPEG_BIN, ['-y', '-loglevel', 'error', '-i', webp, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", png]);
      p.on('error', falha);
      p.on('close', (code) => (code === 0 ? ok() : falha(new Error('ffmpeg ' + code))));
    });
    return { arquivo: nomeArquivo, papel: 'original', descricao: `quadro do vídeo original de @${m.author}` };
  } catch { return null; }
}

// ---- imagens enviadas pelo usuário (elementos e referências)
const PASTA_IMG_TEMP = path.join(PASTAS.temp, 'imagens');
await fs.mkdir(PASTA_IMG_TEMP, { recursive: true });
const EXT_IMG = /^.(png|jpe?g|webp|gif|svg)$/i;
app.post('/api/imagens', async (req, res) => {
  const original = path.basename(String(req.query.nome || 'imagem.png'));
  const ext = path.extname(original).toLowerCase();
  if (!EXT_IMG.test(ext)) return res.status(400).json({ erro: 'Envie PNG, JPG, WEBP, GIF ou SVG.' });
  const id = `${slugify(path.basename(original, ext)).slice(0, 30)}-${novoId()}${ext}`;
  const ws = createWriteStream(path.join(PASTA_IMG_TEMP, id));
  req.pipe(ws);
  ws.on('finish', () => res.json({ id, nome: original, url: `/arquivos/imagens-temp/${id}` }));
  ws.on('error', (e) => res.status(500).json({ erro: e.message }));
});
app.use('/arquivos/imagens-temp', express.static(PASTA_IMG_TEMP));
/** lista de {id, papel, descricao} → só as que existem, com o nome do arquivo */
function imagensTemp(lista) {
  return (Array.isArray(lista) ? lista : [])
    .filter((i) => /^[a-z0-9-]+.[a-z]+$/i.test(i.id || '') && existsSync(path.join(PASTA_IMG_TEMP, i.id)))
    .map((i) => ({ arquivo: i.id, papel: i.papel === 'referencia' ? 'referencia' : 'elemento', descricao: String(i.descricao || '').slice(0, 200) }));
}
async function moverImagens(lista, destino) {
  await fs.mkdir(destino, { recursive: true });
  const ok = imagensTemp(lista);
  for (const i of ok) await fs.copyFile(path.join(PASTA_IMG_TEMP, i.arquivo), path.join(destino, i.arquivo));
  return ok;
}
// ---- vídeo de referência enviado pelo usuário: vira uma sequência de quadros com tempo
const PASTA_REF = path.join(PASTAS.temp, 'video-ref');
await fs.mkdir(PASTA_REF, { recursive: true });
app.use('/arquivos/video-ref', express.static(PASTA_REF));
const EXT_VIDEO = /^.(mp4|mov|webm|mkv|avi|m4v|gif)$/i;

function extrairQuadro(video, t, saida) {
  return new Promise((ok, falha) => {
    const p = spawn(FFMPEG_BIN, ['-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', "scale='if(gt(ih,iw),-2,min(960,iw))':'if(gt(ih,iw),min(960,ih),-2)'", saida]);
    p.on('error', falha);
    p.on('close', (code) => (code === 0 ? ok() : falha(new Error('ffmpeg ' + code))));
  });
}

app.post('/api/video-referencia', async (req, res) => {
  const original = path.basename(String(req.query.nome || 'referencia.mp4'));
  const ext = path.extname(original).toLowerCase();
  if (!EXT_VIDEO.test(ext)) return res.status(400).json({ erro: 'Envie um vídeo (MP4, MOV, WEBM, MKV, AVI ou GIF).' });
  const id = `ref-${novoId()}`;
  const pasta = path.join(PASTA_REF, id);
  await fs.mkdir(pasta, { recursive: true });
  const arq = path.join(pasta, 'video' + ext);
  try {
    await new Promise((ok, falha) => { const ws = createWriteStream(arq); req.pipe(ws); ws.on('finish', ok); ws.on('error', falha); });
    const info = await sondar(arq);
    if (!info.largura || !info.duracao) throw new Error('Não consegui ler esse vídeo.');
    // quadros espalhados pelo vídeo inteiro (~1 a cada 1,5 s, entre 5 e 12)
    const n = Math.min(12, Math.max(5, Math.round(info.duracao / 1.5)));
    const quadros = [];
    for (let k = 0; k < n; k++) {
      const t = Math.min(info.duracao - 0.05, (info.duracao * (k + 0.5)) / n);
      const nome = `ref-${String(k + 1).padStart(2, '0')}-${t.toFixed(1)}s.png`;
      await extrairQuadro(arq, t, path.join(pasta, nome));
      quadros.push({ arquivo: nome, t: +t.toFixed(2), url: `/arquivos/video-ref/${id}/${nome}` });
    }
    const meta = { id, nomeOriginal: original, duracao: info.duracao, largura: info.largura, altura: info.altura, temAudio: info.temAudio, quadros };
    await gravarJson(path.join(pasta, 'meta.json'), meta);
    res.json(meta);
  } catch (e) {
    await fs.rm(pasta, { recursive: true, force: true });
    res.status(400).json({ erro: e.message });
  }
});

/** Copia os quadros do vídeo de referência para a pasta e devolve as entradas de imagem (papel "original", com tempo). */
async function quadrosDaReferencia(idRef, destino) {
  if (!/^ref-[a-z0-9]+$/i.test(idRef || '')) return [];
  const pasta = path.join(PASTA_REF, idRef);
  const meta = await lerJson(path.join(pasta, 'meta.json'), null);
  if (!meta) return [];
  await fs.mkdir(destino, { recursive: true });
  const saida = [];
  for (const q of meta.quadros) {
    await fs.copyFile(path.join(pasta, q.arquivo), path.join(destino, q.arquivo));
    saida.push({ arquivo: q.arquivo, papel: 'original', t: q.t, descricao: `quadro do vídeo de referência em ${q.t.toFixed(1)}s de ${meta.duracao.toFixed(1)}s (${meta.largura}×${meta.altura})` });
  }
  return saida;
}

app.get('/p/:id/assets/:arquivo', (req, res) => {
  if (!idValido(req.params.id)) return res.status(400).end();
  const arq = path.join(pastaProjeto(req.params.id), 'assets', path.basename(req.params.arquivo));
  if (!existsSync(arq)) return res.status(404).end();
  res.sendFile(arq);
});

app.get(['/p/:id', '/p/:id/'], async (req, res) => {
  if (!idValido(req.params.id)) return res.status(400).end();
  if (!req.path.endsWith('/')) return res.redirect(req.originalUrl.replace(/(\?|$)/, '/$1'));
  const p = await lerProjeto(req.params.id);
  const n = Number(req.query.v) || p?.versaoAtual;
  if (!n) return res.status(404).send('<body style="background:#111;color:#999;font:16px sans-serif;display:grid;place-items:center;height:100vh;margin:0">Ainda gerando…</body>');
  res.set('Cache-Control', 'no-store');
  const html = await fs.readFile(path.join(pastaProjeto(p.id), `v${n}.html`), 'utf8');
  // animação por cima do vídeo: a página nunca pinta o fundo (o vídeo da pessoa fica por baixo)
  res.type('html').send(p.ajustes?.sobreVideo ? html.replace(/<head[^>]*>/i, (m) => `${m}<style>:root{color-scheme:normal!important}html,body{background:transparent!important}</style>`) : html);
});
app.get('/p/:id/fundo', async (req, res) => {
  if (!idValido(req.params.id)) return res.status(400).end();
  const p = await lerProjeto(req.params.id);
  const arq = p?.videoFundo && path.join(pastaProjeto(p.id), 'assets', path.basename(p.videoFundo.arquivo));
  if (!arq || !existsSync(arq)) return res.status(404).end();
  res.sendFile(arq);
});

app.post('/api/projetos/:id/render', async (req, res) => {
  const p = await lerProjeto(req.params.id);
  if (!p?.versaoAtual) return res.status(404).json({ erro: 'Projeto sem animação para renderizar.' });
  const o = req.body || {};
  const largura = Math.round((+o.largura || p.ajustes.largura) / 2) * 2;
  const altura = Math.round((+o.altura || p.ajustes.altura) / 2) * 2;
  const fps = Math.min(60, Math.max(12, +o.fps || 30));
  const duracao = Math.min(300, Math.max(0.5, +o.duracao || p.ajustes.duracao));
  const versao = +o.versao || p.versaoAtual;
  const job = criarJob('render', { projetoId: p.id });
  msgJob(job, 'Na fila de render…');
  naFila(async () => {
    job.status = 'rodando';
    const nome = await nomeLivre(PASTAS.midia, `${slugify(p.nome)}-v${versao}-${altura > largura ? 'vertical' : largura === altura ? 'quadrado' : 'horizontal'}`, '.mp4');
    const saida = path.join(PASTAS.midia, nome);
    const atualAudio = (await lerProjeto(p.id)) || p;
    const faixas = o.comAudio === false ? [] : faixasDoProjeto(atualAudio, pastaProjeto(p.id), +o.pularInicio || 0);
    const mudo = faixas.length ? path.join(PASTAS.temp, `${job.id}-mudo.mp4`) : saida;
    // animação por cima do vídeo: renderiza com fundo transparente e depois compõe sobre o vídeo enviado
    const anim = p.videoFundo ? path.join(PASTAS.temp, `${job.id}-anim.mov`) : null;
    try {
      await renderizarHtml({
        url: `${BASE}/p/${p.id}/?v=${versao}`,
        saida: anim || mudo, transparente: !!anim, largura, altura, fps, duracao,
        layoutLargura: p.ajustes.largura,
        layoutAltura: Math.round(p.ajustes.largura * (altura / largura)),
        pularInicio: +o.pularInicio || 0,
        sinal: job.controle.signal,
        progresso: (pr, m) => { if (pr != null) job.progresso = pr; msgJob(job, m); },
      });
      if (anim) {
        msgJob(job, 'Colocando a animação por cima do seu vídeo…');
        await comporSobreVideo({ fundo: path.join(pastaProjeto(p.id), 'assets', p.videoFundo.arquivo), anim, saida: mudo, largura, altura, fps, duracao, inicio: +o.pularInicio || 0, sinal: job.controle.signal });
        await fs.rm(anim, { force: true });
      }
      if (faixas.length) {
        msgJob(job, 'Mixando voz e efeitos no vídeo…');
        await aplicarAudioNoVideo(mudo, faixas, saida);
        await fs.rm(mudo, { force: true });
      }
      const item = await registrarMidia(saida, { origem: 'render', projetoId: p.id, titulo: `${p.nome} (v${versao})${p.videoFundo ? ' (com seu vídeo)' : ''}` });
      const atual = await lerProjeto(p.id);
      if (atual) { atual.renders = [...(atual.renders || []), nome]; await salvarProjeto(atual); }
      job.resultado = item;
      job.status = 'ok';
      job.progresso = 1;
    } catch (e) {
      await fs.rm(saida, { force: true });
      if (mudo !== saida) await fs.rm(mudo, { force: true });
      if (anim) await fs.rm(anim, { force: true });
      job.status = 'erro';
      job.erro = e.message;
      msgJob(job, 'Erro: ' + e.message);
    }
  });
  res.json({ job: jobPublico(job) });
});

audioHooks = registrarRotasAudio(app, {
  DADOS, PASTAS, lerProjeto, salvarProjeto, pastaProjeto, criarJob, msgJob, jobPublico, lerJson, gravarJson, slugify,
  montarPedido, montarSincronia, iniciarGeracao, renderizarHtml, BASE,
});

registrarRotasKie(app, { DADOS, PASTAS, criarJob, msgJob, jobPublico, lerJson, gravarJson, registrarMidia });
registrarRotasGerador(app, { DADOS, PASTAS, criarJob, msgJob, lerJson, gravarJson, registrarMidia });

// ---- jobs
app.get('/api/jobs', (_req, res) => {
  res.json([...jobs.values()].filter((j) => j.status === 'fila' || j.status === 'rodando').map(jobPublico));
});
app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ erro: 'Tarefa não encontrada (o servidor pode ter reiniciado).' });
  res.json(jobPublico(j));
});
app.post('/api/jobs/:id/cancelar', (req, res) => {
  const j = jobs.get(req.params.id);
  j?.controle.abort();
  res.json({ ok: !!j });
});

// ---- mídia
app.get('/api/midia', (_req, res) => {
  midias = midias.filter((m) => existsSync(path.join(PASTAS.midia, m.nome)));
  res.json(midias);
});
app.delete('/api/midia/:nome', async (req, res) => {
  const nome = path.basename(req.params.nome);
  await fs.rm(path.join(PASTAS.midia, nome), { force: true });
  await fs.rm(path.join(PASTAS.miniaturas, nome + '.jpg'), { force: true });
  midias = midias.filter((m) => m.nome !== nome);
  await salvarMidias();
  res.json({ ok: true });
});
app.post('/api/midia/abrir-pasta', (_req, res) => {
  spawn('explorer', [PASTAS.midia], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true });
});

// ---- editor
const ARQ_EDICAO = path.join(DADOS, 'edicao.json');
app.get('/api/edicao', async (_req, res) => res.json(await lerJson(ARQ_EDICAO, null)));
app.put('/api/edicao', async (req, res) => { await gravarJson(ARQ_EDICAO, req.body); res.json({ ok: true }); });

/** Resolve os nomes de mídia da edição para caminhos de arquivo (ou devolve { erro }). */
function resolverEdicao(tl) {
  if (!Array.isArray(tl.clipes) || !tl.clipes.length) return { erro: 'A timeline está vazia.' };
  const porNome = new Map(midias.map((m) => [m.nome, m]));
  const clipes = [];
  for (const c of tl.clipes) {
    if (c.tipo === 'cartela') { clipes.push({ ...c, tipo: 'cartela', temAudio: false }); continue; }
    const m = porNome.get(c.midia);
    if (!m) return { erro: `O clipe "${c.midia}" aponta para um arquivo que foi apagado. Remova-o da timeline.` };
    clipes.push({ ...c, arquivo: path.join(PASTAS.midia, m.nome), tipo: m.tipo, temAudio: m.temAudio });
  }
  let musica = null;
  if (tl.musica?.midia) {
    const m = porNome.get(tl.musica.midia);
    if (m) musica = { ...tl.musica, arquivo: path.join(PASTAS.midia, m.nome) };
  }
  const audios = (tl.audios || []).map((x) => {
    const m = porNome.get(x.midia);
    return m ? { ...x, arquivo: path.join(PASTAS.midia, m.nome) } : null;
  }).filter(Boolean);
  return { edicao: { ...tl, clipes, musica, audios } };
}

app.post('/api/exportar', async (req, res) => {
  const tl = req.body || {};
  const { edicao, erro } = resolverEdicao(tl);
  if (erro) return res.status(400).json({ erro });
  const job = criarJob('exportacao');
  msgJob(job, 'Na fila de exportação…');
  naFila(async () => {
    job.status = 'rodando';
    msgJob(job, 'Montando o vídeo com ffmpeg…');
    const temp = path.join(PASTAS.temp, job.id);
    await fs.mkdir(temp, { recursive: true });
    const nome = await nomeLivre(PASTAS.midia, `${slugify(tl.nome || 'edicao')}-final`, '.mp4');
    const saida = path.join(PASTAS.midia, nome);
    try {
      const total = await exportarEdicao(edicao, saida, temp, (pr) => {
        job.progresso = pr;
        job.ultima = `Codificando… ${Math.round(pr * 100)}%`;
      });
      job.resultado = await registrarMidia(saida, { origem: 'edicao', titulo: tl.nome || 'Edição final' });
      job.status = 'ok';
      job.progresso = 1;
      msgJob(job, `Exportado: ${nome} (${total.toFixed(1)}s)`);
    } catch (e) {
      await fs.rm(saida, { force: true });
      job.status = 'erro';
      job.erro = e.message;
      msgJob(job, 'Erro: ' + e.message);
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
  res.json({ job: jobPublico(job) });
});

// legendas automáticas: mixa as falas da edição (sem a trilha), transcreve e devolve as palavras com tempo
app.post('/api/edicao/legendas', async (req, res) => {
  const { edicao, erro } = resolverEdicao(req.body || {});
  if (erro) return res.status(400).json({ erro });
  const job = criarJob('audio', { rotulo: 'Gerando legendas automáticas' });
  job.status = 'rodando';
  job.ultima = 'Juntando o áudio da edição…';
  res.json({ job: jobPublico(job) });
  const temp = path.join(PASTAS.temp, job.id);
  await fs.mkdir(temp, { recursive: true });
  try {
    const wav = path.join(temp, 'falas.wav');
    await exportarEdicao(edicao, wav, temp, null, { soAudio: true, semMusica: true });
    job.progresso = 0.2;
    job.ultima = 'Transcrevendo as falas (Whisper, offline)…';
    const t = await transcrever({ arquivo: wav, pastaTemp: PASTAS.temp, dica: String(req.body?.dica || req.body?.nome || ''), sinal: job.controle.signal });
    if (!t.palavras.length) throw new Error('Não encontrei fala no áudio da edição. Os clipes têm voz? (vídeos 🔇 não têm som)');
    job.resultado = { palavras: t.palavras, duracao: t.duracao };
    job.status = 'ok';
    job.progresso = 1;
    msgJob(job, `${t.palavras.length} palavras transcritas.`);
  } catch (e) {
    job.status = 'erro';
    job.erro = e.message;
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

app.listen(PORTA, '127.0.0.1', () => {
  console.log(`\n  Estúdio de Vídeo Opus rodando em ${BASE}\n`);
  if (process.argv.includes('--abrir')) spawn('cmd', ['/c', 'start', '', BASE], { detached: true, stdio: 'ignore' }).unref();
});

