// Zips de pacotes de efeitos (Downloads), espaço em disco e extração.
// No Windows usa o tar.exe do sistema (bsdtar, lê .zip); fora dele, unzip.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MIN_ZIP = 10 * 1024 * 1024;

/** .zip com mais de 10 MB, mais novos primeiro; os da Sonniss/GDC marcados. */
export async function listarZips(dir = path.join(os.homedir(), 'Downloads')) {
  const out = [];
  for (const d of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!d.isFile() || !/\.zip$/i.test(d.name)) continue;
    const caminho = path.join(dir, d.name);
    const st = await fs.stat(caminho).catch(() => null);
    if (!st || st.size <= MIN_ZIP) continue;
    out.push({ nome: d.name, caminho, tamanho: st.size, sonniss: /sonniss|gdc/i.test(d.name), mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime).map(({ mtime, ...z }) => z);
}

/** Bytes livres no disco de `dir`. */
export async function espacoLivre(dir) {
  const s = await fs.statfs(dir);
  return s.bavail * s.bsize;
}

/** Descompacta o zip em `destino`. Erro → "Falha ao descompactar: …". */
export async function extrairZip(zip, destino, { sinal } = {}) {
  await fs.mkdir(destino, { recursive: true });
  const [bin, args] = process.platform === 'win32'
    ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', destino]]
    : ['unzip', ['-q', zip, '-d', destino]];
  await new Promise((ok, falha) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    sinal?.addEventListener('abort', () => p.kill());
    p.on('error', (e) => falha(new Error('Falha ao descompactar: ' + e.message)));
    p.on('close', (c) => (c === 0 ? ok() : falha(new Error('Falha ao descompactar: ' + (err.trim().split('\n').pop() || `código ${c}`)))));
  });
}
