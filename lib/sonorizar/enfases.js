// Ênfases da fala: o Claude lê SÓ o texto transcrito (com tempos) e marca os momentos que pedem um
// som de destaque (preço, número, nome do produto, "agora", virada, chamada final).
import { perguntarClaude } from '../claude.js';

const CATEGORIAS = ['impacto', 'brilho', 'whoosh', 'grave', 'riser', 'clique'];

function extrairLista(texto) {
  const bloco = /```(?:json)?\s*([\s\S]*?)```/i.exec(texto);
  const bruto = bloco ? bloco[1] : texto.slice(texto.indexOf('['), texto.lastIndexOf(']') + 1);
  try { const v = JSON.parse(bruto); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** [{ t, categoria, motivo }] — no máximo 1 a cada 2 s; qualquer falha devolve []. */
export async function pedirEnfases({ frases = [], palavras = [], duracao, perguntar = perguntarClaude, sinal }) {
  if (!frases.length) return [];
  const pedido = [
    'Você é editor de vídeos curtos para redes sociais. Abaixo está a fala de um vídeo, com o tempo (em segundos).',
    'Marque os MOMENTOS DE ÊNFASE que merecem um efeito sonoro de destaque: números e preços, nome do produto,',
    '"agora", "hoje", "grátis", viradas da história e a chamada final. Use o início da palavra como tempo.',
    `Para cada um escolha a categoria do som: ${CATEGORIAS.join(', ')} (riser termina no momento; brilho para revelações leves).`,
    'Seja seletivo: no máximo 1 momento a cada 2 segundos.',
    'Responda SOMENTE com um bloco json: [{"t": 1.6, "categoria": "impacto", "motivo": "preço"}]',
    '',
    'FRASES:',
    ...frases.map((f) => `[${f.inicio.toFixed(2)}–${f.fim.toFixed(2)}] ${f.texto}`),
    '',
    'PALAVRAS (tempo de início):',
    palavras.map((w) => `${w.inicio.toFixed(2)} ${w.p}`).join(' · '),
  ].join('\n');
  let lista;
  try {
    const r = await perguntar({ sistema: 'Você marca ênfases de fala para sonoplastia. Responda só com JSON.', pedido, sinal, timeoutMs: 180_000 });
    lista = extrairLista(r?.texto || '');
  } catch { return []; }
  const out = [];
  for (const e of lista.map((x) => ({ t: Math.min(duracao, Math.max(0, +x?.t || 0)), categoria: x?.categoria, motivo: String(x?.motivo || '').slice(0, 120) }))
    .filter((x) => CATEGORIAS.includes(x.categoria)).sort((a, b) => a.t - b.t)) {
    if (out.length && e.t - out[out.length - 1].t < 2) continue;
    out.push(e);
  }
  return out;
}
