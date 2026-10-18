// Aba "Efeitos": biblioteca de efeitos sonoros reais (ex.: Sonniss GDC). Importar pacotes, buscar,
// ouvir e favoritar. Os sons ficam só neste PC (dados/), a licença não permite redistribuir.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FFMPEG } from './ffmpeg.js';
import { CATEGORIAS } from './biblioteca/classificar.js';
import { buscar, contarCategorias, lerCatalogo } from './biblioteca/catalogo.js';
import { listarZips, espacoLivre } from './biblioteca/importar.js';
import { importarPacote } from './biblioteca/pacote.js';

export function registrarRotasEfeitos(app, ctx) {
  const { DADOS, criarJob, msgJob, jobPublico, lerJson, gravarJson } = ctx;
  // pasta própria: separada da "Minha biblioteca" da aba Som (dados/biblioteca-sfx, com importados/ e elevenlabs/)
  const raiz = path.join(DADOS, 'biblioteca-efeitos');
  const ARQ_FAV = path.join(DADOS, 'efeitos-favoritos.json');
  let catalogo = null;
  let porId = new Map();
  let importando = null;
  const carregar = async () => {
    catalogo = await lerCatalogo(raiz);
    porId = new Map(catalogo.sons.map((s) => [s.id, s]));
    return catalogo;
  };
  const cat = async () => catalogo || carregar();
  const favoritos = async () => new Set(await lerJson(ARQ_FAV, []));

  app.get('/api/efeitos/zips', async (_req, res) => {
    res.json({ zips: await listarZips(), livre: await espacoLivre(DADOS).catch(() => 0) });
  });

  app.post('/api/efeitos/importar', async (req, res) => {
    if (importando) return res.status(409).json({ erro: 'Já há um pacote sendo importado.', job: jobPublico(importando) });
    const { caminho, apagarZip = true } = req.body || {};
    const job = criarJob('efeitos', { rotulo: 'Importando pacote' });
    job.status = 'rodando';
    importando = job;
    res.json({ job: jobPublico(job) });
    try {
      const r = await importarPacote({
        caminho, raiz, apagarZip, sinal: job.controle.signal,
        aoMsg: (m) => msgJob(job, m),
        aoProgresso: (feitos, total) => { job.progresso = total ? feitos / total : 0; job.ultima = `Catalogando ${feitos}/${total} arquivos…`; },
      });
      await carregar();
      job.resultado = r;
      job.progresso = 1;
      job.status = 'ok';
      msgJob(job, `${r.arquivos} sons (${r.fatias} fatias) importados, ${r.pulados} pulados`);
    } catch (e) {
      job.status = 'erro';
      job.erro = e.message;
      msgJob(job, 'Erro: ' + e.message);
    } finally {
      importando = null;
    }
  });

  app.get('/api/efeitos/categorias', async (_req, res) => {
    const c = await cat();
    const n = contarCategorias(c.sons);
    res.json({ total: c.sons.length, categorias: CATEGORIAS.map((x) => ({ ...x, n: n[x.id] || 0 })), pacotes: c.pacotes });
  });

  app.get('/api/efeitos/sons', async (req, res) => {
    const c = await cat();
    const fav = await favoritos();
    const q = req.query;
    const r = buscar(c.sons, {
      q: String(q.q || ''), categoria: q.categoria || undefined, duracao: q.duracao || undefined, macio: q.macio || undefined,
      favoritos: fav, soFavoritos: q.fav === '1', pagina: Math.max(0, +q.pagina || 0),
    });
    res.json({
      total: r.total,
      itens: r.itens.map((s) => ({
        id: s.id, nome: s.nome, pacote: s.pacote, duracao: s.duracao, categoria: s.categoria, tags: s.tags, macio: s.macio,
        onda: s.onda, fatia: !!s.pai, golpe: s.pai ? +(/\(golpe (\d+)\)$/.exec(s.nome)?.[1] || 0) : null, fav: fav.has(s.id),
      })),
    });
  });

  app.get('/api/efeitos/ouvir/:id', async (req, res) => {
    await cat();
    const s = porId.get(String(req.params.id));
    if (!s) return res.status(404).end();
    const abs = path.resolve(raiz, s.arquivo);
    if (!abs.startsWith(path.resolve(raiz) + path.sep) || !existsSync(abs)) return res.status(404).end();
    if (s.inicio == null) return res.sendFile(abs);
    // fatia: recorta uma vez e guarda no cache
    const cache = path.join(raiz, '.cache', `${s.id}.wav`);
    if (!existsSync(cache)) {
      await fs.mkdir(path.dirname(cache), { recursive: true });
      const ok = await new Promise((fim) => {
        const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(s.inicio), '-t', String(s.fim - s.inicio), '-i', abs, cache], { stdio: 'ignore' });
        p.on('error', () => fim(false));
        p.on('close', (c) => fim(c === 0));
      });
      if (!ok) return res.status(500).end();
    }
    res.sendFile(cache, { dotfiles: 'allow' }); // a pasta .cache começa com ponto: o Express ignoraria
  });

  app.post('/api/efeitos/favorito', async (req, res) => {
    const { id, ativo } = req.body || {};
    const fav = await favoritos();
    if (ativo) fav.add(String(id)); else fav.delete(String(id));
    await gravarJson(ARQ_FAV, [...fav]);
    res.json({ ok: true });
  });
}
