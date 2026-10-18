// Importa um pacote de efeitos de ponta a ponta: valida → extrai (zip) ou copia (pasta) para a biblioteca
// → cataloga → classifica o que as regras não resolveram (Claude, só texto) → grava o catálogo.
// Qualquer falha remove a pasta do pacote e não toca no catálogo.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classificarComClaude } from './classificar.js';
import { indexarPacote, lerCatalogo, gravarCatalogo } from './catalogo.js';
import { espacoLivre, extrairZip } from './importar.js';

const GB = 1024 ** 3;
const dentro = (filho, pai) => { const r = path.relative(path.resolve(pai), path.resolve(filho)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
const nomeDoPacote = (s) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').trim().slice(0, 120) || 'pacote';

const EXT_AUDIO = /\.(wav|mp3|flac|ogg|aiff?)$/i;
/** Arquivos de áudio de uma pasta (relativos) e o tamanho somado: importar uma pasta copia só eles. */
async function audiosDaPasta(dir) {
  const lista = [];
  let total = 0;
  for (const rel of await fs.readdir(dir, { recursive: true })) {
    if (!EXT_AUDIO.test(rel)) continue;
    const st = await fs.stat(path.join(dir, rel)).catch(() => null);
    if (st?.isFile()) { lista.push(rel); total += st.size; }
  }
  return { lista, total };
}

/** Devolve { pacote, arquivos, fatias, pulados }. raiz = dados/biblioteca-sfx. */
export async function importarPacote({ caminho, raiz, pastaZips = path.join(os.homedir(), 'Downloads'), apagarZip = true,
  classificar = classificarComClaude, aoMsg, aoProgresso, sinal }) {
  const abs = path.resolve(String(caminho || ''));
  const st = await fs.stat(abs).catch(() => null);
  const ehZip = !!st?.isFile() && /\.zip$/i.test(abs);
  if (!ehZip && !st?.isDirectory()) throw new Error('Escolha um arquivo .zip ou uma pasta existente.');
  if (dentro(abs, path.dirname(raiz))) throw new Error('Escolha um pacote fora da pasta do estúdio.');
  if (ehZip && !dentro(abs, pastaZips)) throw new Error('O .zip precisa estar na pasta Downloads.');

  const pacote = nomeDoPacote(path.basename(abs).replace(/\.zip$/i, ''));
  const catalogo = await lerCatalogo(raiz);
  if (catalogo.pacotes.some((p) => p.id === pacote)) throw new Error('Esse pacote já está na biblioteca');

  await fs.mkdir(raiz, { recursive: true });
  const audios = ehZip ? null : await audiosDaPasta(abs);
  const precisa = 1.1 * (ehZip ? st.size : audios.total);
  const livre = await espacoLivre(raiz);
  if (livre < precisa) throw new Error(`Espaço insuficiente: precisa de ${(precisa / GB).toFixed(1)} GB livres, há ${(livre / GB).toFixed(1)} GB`);

  const destino = path.join(raiz, pacote);
  await fs.rm(destino, { recursive: true, force: true }); // sobra de uma importação interrompida
  try {
    aoMsg?.(ehZip ? 'Descompactando o pacote…' : 'Copiando a pasta para a biblioteca…');
    if (ehZip) await extrairZip(abs, destino, { sinal });
    else {
      for (const rel of audios.lista) {
        await fs.mkdir(path.dirname(path.join(destino, rel)), { recursive: true });
        await fs.copyFile(path.join(abs, rel), path.join(destino, rel));
      }
    }
    aoMsg?.('Catalogando os sons (medidas, fatias e categorias)…');
    const r = await indexarPacote({ raiz, pasta: destino, pacote, aoProgresso, sinal });
    // um .zip qualquer (sem áudio) não vira pacote vazio, e o .zip não é apagado
    if (!r.arquivos) throw new Error('Nenhum som encontrado nesse pacote.');
    const semCategoria = r.sons.filter((s) => !s.pai && !s.categoria);
    if (semCategoria.length) {
      aoMsg?.(`O Claude está classificando ${semCategoria.length} sons pelo nome…`);
      const mapa = await classificar(semCategoria.map(({ id, nome, descricao }) => ({ id, nome, descricao })), {
        sinal, aoLote: (k, n) => aoMsg?.(`O Claude está classificando ${semCategoria.length} sons pelo nome — lote ${k} de ${n}…`),
      });
      for (const s of r.sons) {
        const c = mapa.get(s.pai || s.id);
        if (!s.categoria && c) { s.categoria = c.categoria; s.tags = c.tags; }
      }
    }
    for (const s of r.sons) if (!s.categoria) s.categoria = 'outros';
    catalogo.pacotes.push({ id: pacote, nome: pacote, pasta: pacote, importado: Date.now(), arquivos: r.arquivos, fatias: r.fatias, pulados: r.pulados });
    catalogo.sons.push(...r.sons);
    await gravarCatalogo(raiz, catalogo);
    if (ehZip && apagarZip) await fs.rm(abs, { force: true });
    return { pacote, arquivos: r.arquivos, fatias: r.fatias, pulados: r.pulados };
  } catch (e) {
    await fs.rm(destino, { recursive: true, force: true });
    throw e;
  }
}
