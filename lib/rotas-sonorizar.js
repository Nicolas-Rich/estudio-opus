// Aba Efeitos › "Sonorizar vídeo": abrir um vídeo da Mídia, analisar, sugerir sons da biblioteca,
// ajustar na linha do tempo e exportar o MP4 com efeitos de volta para a Mídia.
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { obterCatalogo } from './biblioteca/cache.js';
import { PAPEIS } from './sonorizar/papeis.js';
import { montarKit, sugerirClipes } from './sonorizar/sugerir.js';
import { idDaMidia, novaSonorizacao, lerSonorizacao, gravarSonorizacao, validarClipes } from './sonorizar/sessao.js';
import { analisarParaSonorizar } from './sonorizar/analisar.js';
import { montarFaixaEfeitos, exportarSonorizado } from './sonorizar/exportar.js';

const INTENSIDADES = ['sutil', 'equilibrado', 'intenso'];
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'video';

export function registrarRotasSonorizar(app, ctx) {
  const { DADOS, PASTAS, criarJob, msgJob, jobPublico, lerJson, gravarJson, registrarMidia, nomeLivre } = ctx;
  const deps = { analise: analisarParaSonorizar, montarFaixa: montarFaixaEfeitos, exportarVideo: exportarSonorizado, ...(ctx.deps || {}) };
  const pasta = path.join(DADOS, 'efeitos-sonorizacoes');
  const raizBib = path.join(DADOS, 'biblioteca-efeitos');
  const analisando = new Map();
  const midias = async () => (await lerJson(path.join(DADOS, 'midia.json'), [])).filter((m) => m.tipo === 'video');
  const favoritos = async () => new Set(await lerJson(path.join(DADOS, 'efeitos-favoritos.json'), []));

  /** Kit + clipes sugeridos a partir da análise salva. */
  async function sugerir(s) {
    const { catalogo } = await obterCatalogo(raizBib);
    const a = s.analise;
    const papeis = [...Object.keys(PAPEIS), ...new Set(a.enfases.map((e) => `enfase:${e.categoria}`))];
    const { kit, faltando } = montarKit(catalogo.sons, { favoritos: await favoritos(), papeis });
    s.clipes = sugerirClipes({ eventos: a.eventos, cortes: a.cortes, enfases: a.enfases, kit, intensidade: s.intensidade, duracao: s.duracao });
    s.faltando = faltando;
  }

  /** Sonorização para a tela: descarta sons que sumiram da biblioteca e junta nomes/ondas e avisos. */
  async function completar(s) {
    const { porId } = await obterCatalogo(raizBib);
    const avisos = [];
    const validos = s.clipes.filter((c) => porId.has(c.somId));
    const sumiram = s.clipes.length - validos.length;
    if (sumiram) {
      s.clipes = validos;
      await gravarSonorizacao(pasta, s);
      avisos.push(sumiram === 1 ? '1 som não está mais na biblioteca e saiu da faixa.' : `${sumiram} sons não estão mais na biblioteca e saíram da faixa.`);
    }
    const a = s.analise;
    if (a?.pulados?.length) avisos.push(`Não consegui analisar: ${a.pulados.join(', ')}.`);
    if (a && !s.clipes.length && !a.eventos.length && !a.cortes.length && !a.enfases.length) avisos.push('Nada detectado — arraste sons da biblioteca para a faixa.');
    const sons = {};
    for (const c of s.clipes) {
      const x = porId.get(c.somId);
      sons[c.somId] = { nome: x.nome, categoria: x.categoria, duracao: x.duracao, onda: x.onda, fatia: !!x.pai };
    }
    return { ...s, sons, avisos, faltando: s.faltando || [] };
  }

  const carregar = async (req, res) => {
    const s = await lerSonorizacao(pasta, req.params.id);
    if (!s) res.status(404).json({ erro: 'Sonorização não encontrada.' });
    return s;
  };

  app.get('/api/sonorizar/videos', async (_req, res) => {
    const out = [];
    for (const m of await midias()) {
      const id = idDaMidia(m.nome);
      const s = await lerSonorizacao(pasta, id).catch(() => null);
      out.push({ id, nome: m.nome, titulo: m.titulo || m.nome, duracao: m.duracao, thumb: m.thumb, clipes: s?.clipes?.length || 0 });
    }
    res.json(out);
  });

  app.post('/api/sonorizar/abrir', async (req, res) => {
    const m = (await midias()).find((x) => x.nome === req.body?.midia);
    if (!m || !existsSync(path.join(PASTAS.midia, m.nome))) return res.status(404).json({ erro: 'Vídeo não encontrado na Mídia.' });
    const { catalogo } = await obterCatalogo(raizBib);
    if (!catalogo.sons.length) return res.status(409).json({ erro: 'Importe uma biblioteca de efeitos primeiro.' });
    const id = idDaMidia(m.nome);
    const s = (await lerSonorizacao(pasta, id)) || novaSonorizacao({ midia: m.nome, duracao: m.duracao, largura: m.largura, altura: m.altura, temAudio: m.temAudio });
    if (s.analise) return res.json({ sessao: await completar(s) });
    if (analisando.has(id)) return res.json({ sessao: s, job: jobPublico(analisando.get(id)) });
    await gravarSonorizacao(pasta, s);
    const job = criarJob('efeitos', { rotulo: 'Analisando o vídeo' });
    job.status = 'rodando';
    analisando.set(id, job);
    res.json({ sessao: s, job: jobPublico(job) });
    try {
      s.analise = await deps.analise({
        video: path.join(PASTAS.midia, m.nome), temAudio: s.temAudio, duracao: s.duracao, pastaTemp: PASTAS.temp,
        sinal: job.controle.signal, aoMsg: (t) => msgJob(job, t),
      });
      await sugerir(s);
      await gravarSonorizacao(pasta, s);
      job.progresso = 1;
      job.status = 'ok';
      msgJob(job, `${s.clipes.length} sons sugeridos.`);
    } catch (e) {
      job.status = 'erro';
      job.erro = e.message;
      msgJob(job, 'Erro: ' + e.message);
    } finally {
      analisando.delete(id);
    }
  });

  app.get('/api/sonorizar/:id', async (req, res) => {
    const s = await carregar(req, res);
    if (s) res.json(await completar(s));
  });

  app.patch('/api/sonorizar/:id', async (req, res) => {
    const s = await carregar(req, res);
    if (!s) return;
    const { porId } = await obterCatalogo(raizBib);
    const b = req.body || {};
    if (b.clipes) s.clipes = validarClipes(b.clipes, { duracao: s.duracao, idsValidos: new Set(porId.keys()) });
    if (INTENSIDADES.includes(b.intensidade)) s.intensidade = b.intensidade;
    if (Number.isFinite(+b.volumeEfeitos) && b.volumeEfeitos !== null) s.volumeEfeitos = Math.min(1.5, Math.max(0, +b.volumeEfeitos));
    await gravarSonorizacao(pasta, s);
    res.json(await completar(s));
  });

  app.post('/api/sonorizar/:id/sugerir', async (req, res) => {
    const s = await carregar(req, res);
    if (!s) return;
    if (!s.analise) return res.status(409).json({ erro: 'O vídeo ainda está sendo analisado.' });
    if (INTENSIDADES.includes(req.body?.intensidade)) s.intensidade = req.body.intensidade;
    await sugerir(s);
    await gravarSonorizacao(pasta, s);
    res.json(await completar(s));
  });

  app.post('/api/sonorizar/:id/exportar', async (req, res) => {
    const s = await carregar(req, res);
    if (!s) return;
    const m = (await midias()).find((x) => x.nome === s.midia);
    const job = criarJob('efeitos', { rotulo: 'Exportando com efeitos' });
    job.status = 'rodando';
    res.json({ job: jobPublico(job) });
    const faixa = path.join(PASTAS.temp, `efx-${s.id}-${Date.now().toString(36)}.wav`);
    let saida = null;
    try {
      const { porId } = await obterCatalogo(raizBib);
      msgJob(job, 'Montando a faixa de efeitos…');
      await deps.montarFaixa({ clipes: s.clipes, sons: porId, raiz: raizBib, duracao: s.duracao, volumeEfeitos: s.volumeEfeitos, saida: faixa });
      const nome = await nomeLivre(PASTAS.midia, `${slug(path.basename(s.midia, path.extname(s.midia)))}-com-efeitos`, '.mp4');
      saida = path.join(PASTAS.midia, nome);
      msgJob(job, 'Mixando com o áudio do vídeo e masterizando (−14 LUFS)…');
      await deps.exportarVideo({ video: path.join(PASTAS.midia, s.midia), temAudio: s.temAudio, faixaEfeitos: faixa, saida, pastaTemp: PASTAS.temp });
      job.resultado = await registrarMidia(saida, { origem: 'efeitos', titulo: `${m?.titulo || s.midia} (com efeitos)` });
      job.progresso = 1;
      job.status = 'ok';
      msgJob(job, `Pronto: ${nome} está na Mídia.`);
    } catch (e) {
      if (saida) await fs.rm(saida, { force: true });
      job.status = 'erro';
      job.erro = e.message;
      msgJob(job, 'Erro: ' + e.message);
    } finally {
      await fs.rm(faixa, { force: true });
    }
  });
}
