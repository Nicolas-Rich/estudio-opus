// Aba "Opus Generator": instala e abre o WanGP (MiniMax H3 e outros modelos de vídeo) na própria máquina.
// O estúdio confere a máquina, baixa o WanGP do GitHub oficial e abre o instalador dele numa janela própria.
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

const REPO_WANGP = 'https://github.com/deepbeepmeep/Wan2GP.git';
const PORTA_WANGP = 7860;
const GB = 1024 ** 3;

// o que o MiniMax H3 pede (README do WanGP e FAQ oficial do H3)
export const REQUISITOS = {
  vramMin: 6, vramBoa: 12,
  ramMin: 24, ramBoa: 32,
  discoMin: 35, discoBom: 50,
};

const rodar = (cmd, args, timeout = 6000) => new Promise((ok) => {
  execFile(cmd, args, { timeout, windowsHide: true }, (erro, saida) => ok(erro ? null : String(saida).trim()));
});

async function placasDeVideo() {
  const nv = await rodar('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  if (nv) {
    return nv.split(/\r?\n/).filter(Boolean).map((l) => {
      const [nome, mib] = l.split(',').map((x) => x.trim());
      return { nome, vram: +(+mib / 1024).toFixed(1), fabricante: 'nvidia' };
    });
  }
  if (process.platform === 'win32') {
    const ps = await rodar('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name']);
    return (ps || '').split(/\r?\n/).filter(Boolean).map((nome) => ({
      nome: nome.trim(), vram: null,
      fabricante: /nvidia/i.test(nome) ? 'nvidia' : /amd|radeon/i.test(nome) ? 'amd' : /intel/i.test(nome) ? 'intel' : 'outra',
    }));
  }
  return [];
}

// espaço livre no disco onde a pasta vai ficar (sobe até achar uma pasta que exista)
async function discoLivre(pasta) {
  let p = path.resolve(pasta);
  while (!existsSync(p) && path.dirname(p) !== p) p = path.dirname(p);
  try { const s = await fs.statfs(p); return +((s.bavail * s.bsize) / GB).toFixed(1); } catch { return null; }
}

async function wangpNoAr() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORTA_WANGP}/`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

// "ausente" → "baixado" (código clonado) → "instalado" (o instalador criou o ambiente Python)
function situacao(pasta) {
  if (existsSync(path.join(pasta, 'envs.json'))) return 'instalado';
  if (existsSync(path.join(pasta, 'wgp.py'))) return 'baixado';
  return 'ausente';
}

function avaliar({ so, ram, placas, disco, git }) {
  const itens = [];
  const add = (id, nome, valor, nivel, detalhe) => itens.push({ id, nome, valor, nivel, detalhe });
  const R = REQUISITOS;

  if (so === 'win32') add('so', 'Sistema', 'Windows', 'ok', 'O botão Instalar funciona direto daqui.');
  else if (so === 'linux') add('so', 'Sistema', 'Linux', 'aviso', 'Instale pelo terminal com scripts/install.sh (comando abaixo).');
  else add('so', 'Sistema', so === 'darwin' ? 'macOS' : so, 'falha', 'O H3 precisa de placa NVIDIA ou AMD. No Mac, use o teste online.');

  const placa = placas.find((p) => p.fabricante === 'nvidia') || placas.find((p) => p.fabricante === 'amd') || placas[0];
  if (!placa) add('gpu', 'Placa de vídeo', 'não encontrada', 'falha', 'Sem placa dedicada: use o teste online.');
  else if (placa.fabricante === 'nvidia') {
    const v = placa.vram;
    const nivel = v == null ? 'aviso' : v >= R.vramMin ? 'ok' : 'falha';
    add('gpu', 'Placa de vídeo', `${placa.nome}${v ? ` · ${v} GB` : ''}`, nivel,
      v == null ? 'Não consegui ler a memória da placa.'
        : v >= R.vramBoa ? 'Folga para clipes mais longos.'
          : v >= R.vramMin ? `Dá para clipes de 5 s em 832x480 (pede ${R.vramMin} GB).`
            : `Pede pelo menos ${R.vramMin} GB de memória de vídeo.`);
  } else if (placa.fabricante === 'amd') {
    add('gpu', 'Placa de vídeo', placa.nome, 'aviso', 'AMD funciona só nas linhas RX 6000 ou mais novas (RDNA 2+), com 6 GB ou mais.');
  } else {
    add('gpu', 'Placa de vídeo', placa.nome, 'falha', 'Precisa de placa NVIDIA (GTX 10xx a RTX 50xx) ou AMD RDNA 2+.');
  }

  add('ram', 'Memória RAM', `${ram} GB`,
    ram >= R.ramBoa ? 'ok' : 'aviso',
    ram >= R.ramBoa ? 'Use o perfil de memória 4 (padrão).'
      : ram >= R.ramMin ? 'Use o perfil de memória 5 (Fail safe). Funciona, mais devagar.'
        : `Abaixo de ${R.ramMin} GB: só com perfil 5 e arquivo de paginação do Windows. Espere ~25 min por clipe de 5 s.`);

  add('disco', 'Espaço livre', disco == null ? '?' : `${disco} GB`,
    disco == null ? 'aviso' : disco >= R.discoBom ? 'ok' : disco >= R.discoMin ? 'aviso' : 'falha',
    disco == null ? 'Não consegui medir o disco.'
      : disco >= R.discoBom ? 'Cabe o programa e o modelo.'
        : `O modelo baixa ~33–42 GB no primeiro uso. Libere pelo menos ${R.discoBom} GB ou escolha outro disco.`);

  add('git', 'Git', git ? git.replace(/^git version /, '') : 'não instalado', git ? 'ok' : 'falha',
    git ? 'Usado para baixar o WanGP.' : 'Instale em git-scm.com e reabra o estúdio.');

  const falhas = itens.filter((i) => i.nivel === 'falha').length;
  const avisos = itens.filter((i) => i.nivel === 'aviso').length;
  const veredito = falhas ? { nivel: 'falha', texto: 'Esta máquina ainda não roda o gerador. Resolva os itens em vermelho ou use o teste online.' }
    : avisos ? { nivel: 'aviso', texto: 'Roda, com ressalvas. Veja os itens em amarelo antes de instalar.' }
      : { nivel: 'ok', texto: 'Máquina pronta. Pode instalar.' };
  return { itens, veredito };
}

const PASTA_INVALIDA = /["&|<>^%!]/;

export function registrarRotasGerador(app, ctx) {
  const { DADOS, PASTAS, criarJob, msgJob, lerJson, gravarJson, registrarMidia } = ctx;
  const ARQ_CONFIG = path.join(DADOS, 'config.json');
  const pastaPadrao = path.join(os.homedir(), 'WanGP');
  const pastaAtual = async () => (await lerJson(ARQ_CONFIG, {})).geradorPasta || pastaPadrao;
  let jobInstalacao = null;

  const validarPasta = (p) => {
    const pasta = String(p || '').trim();
    if (!pasta || !path.isAbsolute(pasta)) throw new Error('Informe o caminho completo da pasta (ex.: D:\\WanGP).');
    if (PASTA_INVALIDA.test(pasta)) throw new Error('O caminho não pode ter os caracteres " & | < > ^ % !');
    return path.resolve(pasta);
  };
  // título sempre com espaço: assim vai entre aspas e o "start" do Windows não o confunde com o comando
  const abrirJanela =(titulo, pasta, script) => spawn('cmd.exe', ['/c', 'start', titulo, '/D', pasta, script], {
    detached: true, stdio: 'ignore',
  }).unref();

  app.get('/api/gerador/maquina', async (_req, res) => {
    const pasta = await pastaAtual();
    const [placas, disco, git, noAr] = await Promise.all([placasDeVideo(), discoLivre(pasta), rodar('git', ['--version']), wangpNoAr()]);
    const maquina = { so: process.platform, ram: +(os.totalmem() / GB).toFixed(1), placas, disco, git };
    res.json({
      ...avaliar(maquina), maquina, requisitos: REQUISITOS, pasta, pastaPadrao,
      situacao: situacao(pasta), noAr, url: `http://127.0.0.1:${PORTA_WANGP}`,
      instalando: jobInstalacao && ['fila', 'rodando'].includes(jobInstalacao.status) ? jobInstalacao.id : null,
    });
  });

  app.put('/api/gerador/pasta', async (req, res) => {
    try {
      const pasta = validarPasta(req.body?.pasta);
      const c = await lerJson(ARQ_CONFIG, {});
      c.geradorPasta = pasta;
      await gravarJson(ARQ_CONFIG, c);
      res.json({ ok: true, pasta, disco: await discoLivre(pasta), situacao: situacao(pasta) });
    } catch (e) { res.status(400).json({ erro: e.message }); }
  });

  // 1) baixa o WanGP do GitHub oficial  2) abre o instalador oficial (scripts\install.bat) numa janela própria
  app.post('/api/gerador/instalar', async (_req, res) => {
    if (process.platform !== 'win32') return res.status(400).json({ erro: 'O botão Instalar é só para Windows. No Linux, use o comando do terminal mostrado na aba.' });
    if (jobInstalacao && ['fila', 'rodando'].includes(jobInstalacao.status)) return res.json({ job: jobInstalacao.id });
    let pasta;
    try { pasta = validarPasta(await pastaAtual()); } catch (e) { return res.status(400).json({ erro: e.message }); }
    if (situacao(pasta) === 'ausente' && existsSync(pasta) && (await fs.readdir(pasta)).length) {
      return res.status(400).json({ erro: `A pasta ${pasta} já existe e não é do WanGP. Escolha uma pasta vazia ou nova.` });
    }
    if (!(await rodar('git', ['--version']))) return res.status(400).json({ erro: 'Instale o Git (git-scm.com) e reabra o estúdio.' });

    const job = (jobInstalacao = criarJob('gerador', { titulo: 'Instalando o Opus Generator' }));
    res.json({ job: job.id });
    job.status = 'rodando';
    try {
      if (situacao(pasta) === 'ausente') {
        msgJob(job, `Baixando o WanGP do GitHub oficial para ${pasta}…`);
        await fs.mkdir(path.dirname(pasta), { recursive: true });
        await new Promise((ok, falha) => {
          const g = spawn('git', ['clone', '--depth', '1', '--progress', REPO_WANGP, pasta], { windowsHide: true, signal: job.controle.signal });
          g.stderr.on('data', (d) => {
            const linha = String(d).split(/[\r\n]+/).filter(Boolean).pop();
            const pct = /Receiving objects:\s+(\d+)%/.exec(linha || '');
            if (pct) job.progresso = +pct[1] / 100 * 0.9;
            if (linha) job.ultima = linha.trim();
          });
          g.on('error', falha);
          g.on('close', (cod) => (cod === 0 ? ok() : falha(new Error(`git clone terminou com erro (${cod}). Verifique a internet e tente de novo.`))));
        });
      } else {
        msgJob(job, 'O WanGP já está baixado nesta pasta. Pulando o download.');
      }
      job.progresso = 0.95;
      msgJob(job, 'Abrindo o instalador oficial do WanGP numa janela nova…');
      abrirJanela('Instalador WanGP', pasta, path.join(pasta, 'scripts', 'install.bat'));
      msgJob(job, 'Na janela do instalador, escolha 1 (Automatic Install). Ele instala Python, PyTorch e as bibliotecas (~10–20 min).');
      job.progresso = 1;
      job.status = 'ok';
    } catch (e) {
      job.status = 'erro';
      job.erro = e.name === 'AbortError' ? 'Instalação cancelada.' : e.message;
      msgJob(job, job.erro);
    }
  });

  app.post('/api/gerador/iniciar', async (_req, res) => {
    if (process.platform !== 'win32') return res.status(400).json({ erro: 'No Linux, rode scripts/run.sh dentro da pasta do WanGP.' });
    const pasta = await pastaAtual();
    if (situacao(pasta) !== 'instalado') return res.status(400).json({ erro: 'O WanGP ainda não terminou de instalar. Rode o instalador primeiro.' });
    if (await wangpNoAr()) return res.json({ ok: true, jaAberto: true });
    abrirJanela('WanGP - Opus Generator', pasta, path.join(pasta, 'scripts', 'run.bat'));
    res.json({ ok: true });
  });

  app.post('/api/gerador/abrir-pasta', async (_req, res) => {
    const pasta = await pastaAtual();
    if (!existsSync(pasta)) return res.status(400).json({ erro: 'A pasta ainda não existe.' });
    spawn('explorer', [pasta], { detached: true, stdio: 'ignore' }).unref();
    res.json({ ok: true });
  });

  // vídeos que o WanGP salvou em <pasta>/outputs → trazer para a Mídia do Editor
  const pastaSaida = async () => path.join(await pastaAtual(), 'outputs');
  app.get('/api/gerador/videos', async (_req, res) => {
    const dir = await pastaSaida();
    const nomes = (await fs.readdir(dir).catch(() => [])).filter((n) => /\.mp4$/i.test(n));
    const lista = await Promise.all(nomes.map(async (nome) => {
      const s = await fs.stat(path.join(dir, nome));
      return { nome, tamanho: s.size, criado: s.mtimeMs, importado: existsSync(path.join(PASTAS.midia, `opus-generator-${nome}`)) };
    }));
    res.json(lista.sort((a, b) => b.criado - a.criado).slice(0, 60));
  });
  app.post('/api/gerador/importar', async (req, res) => {
    const nome = path.basename(String(req.body?.nome || ''));
    const origem = path.join(await pastaSaida(), nome);
    if (!/\.mp4$/i.test(nome) || !existsSync(origem)) return res.status(400).json({ erro: 'Vídeo não encontrado na pasta outputs do WanGP.' });
    try {
      const destino = path.join(PASTAS.midia, `opus-generator-${nome}`);
      await fs.copyFile(origem, destino);
      res.json(await registrarMidia(destino, { origem: 'opus-generator' }));
    } catch (e) { res.status(500).json({ erro: e.message }); }
  });
}
