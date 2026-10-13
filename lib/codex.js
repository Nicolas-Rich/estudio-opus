// Motor alternativo: OpenAI Codex CLI (`codex exec`), usando o login da conta do usuário.
// Recebe as imagens direto (-i), então vê logos, produtos e o quadro do vídeo original.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const MODELOS_CODEX = [
  { id: 'codex:gpt-6-sol', nome: 'GPT-6 Sol (Codex)' },
];

let caminhoCache;
/** Acha o codex.exe: no PATH ou dentro do app Codex (%LOCALAPPDATA%\OpenAI\Codex\bin\<versão>\codex.exe). */
export function acharCodex() {
  if (caminhoCache !== undefined) return caminhoCache;
  caminhoCache = null;
  const base = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  try {
    const candidatos = readdirSync(base)
      .map((d) => path.join(base, d, 'codex.exe'))
      .filter((f) => existsSync(f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (candidatos.length) caminhoCache = candidatos[0];
  } catch {}
  if (!caminhoCache) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      for (const nome of ['codex.exe', 'codex.cmd']) {
        const f = path.join(dir, nome);
        if (existsSync(f)) { caminhoCache = f; return caminhoCache; }
      }
    }
  }
  return caminhoCache;
}

export function versaoCodex() {
  const exe = acharCodex();
  if (!exe) return Promise.resolve(null);
  return new Promise((ok) => {
    const p = spawn(exe, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => ok(null));
    p.on('close', () => ok(out.trim() || null));
  });
}

const EXT_IMG = /\.(png|jpe?g|webp|gif)$/i;

/**
 * Mesmo contrato do perguntarClaude: devolve { texto }.
 * imagens: caminhos de arquivos de imagem para anexar ao pedido.
 */
export async function perguntarCodex({ sistema, pedido, modelo, aoProgresso, sinal, timeoutMs = 25 * 60_000, pastaImagens, imagens = [] }) {
  const exe = acharCodex();
  if (!exe) throw new Error('Não encontrei o Codex. Instale o app Codex (OpenAI) e faça login nele.');
  const anexos = [...imagens];
  if (pastaImagens && existsSync(pastaImagens)) {
    for (const f of readdirSync(pastaImagens)) if (EXT_IMG.test(f)) anexos.push(path.join(pastaImagens, f));
  }
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-codex-'));
  const saida = path.join(pasta, 'resposta.txt');
  const args = ['exec', '-m', String(modelo).replace(/^codex:/, ''), '-s', 'read-only', '--skip-git-repo-check',
    '--ephemeral', '--color', 'never', '-C', pastaImagens && existsSync(pastaImagens) ? pastaImagens : pasta, '-o', saida];
  for (const a of anexos) args.push('-i', a);
  args.push('-');
  const textoPedido = [
    sistema,
    '',
    anexos.length ? `As imagens anexadas são, nesta ordem: ${anexos.map((a) => path.basename(a)).join(', ')}.` : '',
    'Não execute comandos nem altere arquivos: apenas responda com o texto pedido.',
    '',
    pedido,
  ].join('\n');

  return new Promise((ok, falha) => {
    const p = spawn(exe, args, { cwd: pasta, stdio: ['pipe', 'pipe', 'pipe'] });
    const t0 = Date.now();
    aoProgresso?.(0, `Codex conectado (${String(modelo).replace(/^codex:/, '')})`);
    const relogio = setInterval(() => aoProgresso?.(1, `Codex criando o vídeo… ${Math.round((Date.now() - t0) / 1000)}s (costuma levar de 2 a 5 min — pode continuar usando o estúdio)`), 2000);
    const timer = setTimeout(() => { p.kill(); falha(new Error('Tempo esgotado esperando o Codex.')); }, timeoutMs);
    sinal?.addEventListener('abort', () => p.kill());
    let log = '';
    const guardar = (d) => { log += d; if (log.length > 40_000) log = log.slice(-20_000); };
    p.stdout.on('data', guardar);
    p.stderr.on('data', guardar);
    p.on('error', (e) => { clearInterval(relogio); clearTimeout(timer); falha(e); });
    p.on('close', async (code) => {
      clearInterval(relogio);
      clearTimeout(timer);
      try {
        if (sinal?.aborted) throw new Error('Geração cancelada');
        const texto = existsSync(saida) ? await fs.readFile(saida, 'utf8') : '';
        if (!texto.trim()) throw new Error(`O Codex não respondeu (código ${code}). ${log.split('\n').filter(Boolean).slice(-6).join(' ')}`.slice(0, 1200));
        ok({ texto, duracaoMs: Date.now() - t0 });
      } catch (e) {
        falha(e);
      } finally {
        fs.rm(pasta, { recursive: true, force: true }).catch(() => {});
      }
    });
    p.stdin.end(textoPedido, 'utf8');
  });
}
