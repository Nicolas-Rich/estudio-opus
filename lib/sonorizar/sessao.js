// Sonorização salva de um vídeo da Mídia: a análise feita e os sons colocados na linha do tempo.
// Um arquivo por vídeo em dados/efeitos-sonorizacoes/<id>.json, gravado de forma atômica.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const idDaMidia = (nome) => createHash('sha1').update(String(nome)).digest('hex').slice(0, 12);

export function novaSonorizacao({ midia, duracao, largura, altura, temAudio }) {
  const agora = Date.now();
  return {
    id: idDaMidia(midia), midia, duracao, largura, altura, temAudio: !!temAudio, criado: agora, atualizado: agora,
    intensidade: 'equilibrado', volumeEfeitos: 0.8, analise: null, clipes: [],
  };
}

export async function lerSonorizacao(pasta, id) {
  if (!/^[0-9a-f]{12}$/.test(String(id))) return null;
  try { return JSON.parse(await fs.readFile(path.join(pasta, `${id}.json`), 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function gravarSonorizacao(pasta, s) {
  await fs.mkdir(pasta, { recursive: true });
  s.atualizado = Date.now();
  const arq = path.join(pasta, `${s.id}.json`);
  await fs.writeFile(arq + '.tmp', JSON.stringify(s));
  await fs.rename(arq + '.tmp', arq);
}

let seq = 0;
/** Só sons que existem na biblioteca; tempo em [0, duração]; volume em [0, 1,5]. */
export function validarClipes(clipes, { duracao, idsValidos }) {
  return (Array.isArray(clipes) ? clipes : [])
    .filter((c) => c && idsValidos.has(String(c.somId)))
    .map((c) => ({
      uid: String(c.uid || `m${Date.now().toString(36)}${(seq++).toString(36)}`).slice(0, 40),
      somId: String(c.somId),
      t: Math.round(Math.min(duracao, Math.max(0, +c.t || 0)) * 1000) / 1000,
      volume: Math.min(1.5, Math.max(0, Number.isFinite(+c.volume) ? +c.volume : 0.8)),
      papel: String(c.papel || 'manual').slice(0, 30),
    }));
}
