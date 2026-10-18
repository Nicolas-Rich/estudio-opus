// Análise de um vídeo para sonorizar: itens (detector por imagem), cortes de cena e a fala
// (Whisper + ênfases marcadas pelo Claude só no texto). Uma etapa que falha é pulada, não derruba as outras.
import fs from 'node:fs/promises';
import path from 'node:path';
import { quadrosDoVideo, detectarEventos } from '../eventos-visuais.js';
import { analisarVideo } from '../analise-video.js';
import { transcrever } from '../transcricao.js';
import { pedirEnfases } from './enfases.js';

const PADRAO = {
  eventos: async (video) => { const g = await quadrosDoVideo(video); return detectarEventos(g.quadros, g); },
  cortes: async (video, duracao, pastaTemp) => {
    const pasta = await fs.mkdtemp(path.join(pastaTemp, 'cortes-'));
    try { return (await analisarVideo({ video, pasta, duracao })).cortes.map((c) => (typeof c === 'number' ? c : c.t)); }
    finally { await fs.rm(pasta, { recursive: true, force: true }); }
  },
  transcrever: (video, pastaTemp, sinal) => transcrever({ arquivo: video, pastaTemp, sinal }),
  enfases: pedirEnfases,
};

/** { versao, eventos, cortes, fala, enfases, pulados } */
export async function analisarParaSonorizar({ video, temAudio, duracao, pastaTemp, sinal, aoMsg, deps = {} }) {
  const d = { ...PADRAO, ...deps };
  const out = { versao: 1, eventos: [], cortes: [], fala: null, enfases: [], pulados: [] };
  try { aoMsg?.('Detectando os itens que entram e saem…'); out.eventos = await d.eventos(video); } catch { out.pulados.push('itens'); }
  try { aoMsg?.('Procurando os cortes de cena…'); out.cortes = await d.cortes(video, duracao, pastaTemp); } catch { out.pulados.push('cortes'); }
  if (temAudio) {
    try {
      aoMsg?.('Ouvindo a fala (Whisper, no seu PC)…');
      const t = await d.transcrever(video, pastaTemp, sinal);
      out.fala = { frases: t.frases || [], palavras: t.palavras || [] };
      if (out.fala.frases.length) {
        aoMsg?.('O Claude está marcando as ênfases da fala…');
        out.enfases = await d.enfases({ frases: out.fala.frases, palavras: out.fala.palavras, duracao, sinal });
      }
    } catch { out.pulados.push('fala'); }
  }
  return out;
}
