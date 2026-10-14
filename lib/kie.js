// Kie.ai: API que revende modelos de vídeo/imagem (Veo 3.1, Kling, Seedance, Grok…) pagos por geração.
// Fluxo: envia as imagens (upload grátis, ficam 24 h) → cria a tarefa → consulta até terminar → baixa o MP4.
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.kie.ai';
const UPLOAD = 'https://kieai.redpandaai.co';
export const DOLAR_POR_CREDITO = 0.005;

async function kie(url, chave, opcoes = {}) {
  let r;
  try {
    r = await fetch(url, { ...opcoes, headers: { Authorization: `Bearer ${chave}`, ...(opcoes.headers || {}) }, signal: opcoes.signal || AbortSignal.timeout(60_000) });
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') throw e;
    throw new Error('Sem conexão com o Kie.ai: ' + e.message);
  }
  const txt = await r.text();
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error(`Kie.ai respondeu ${r.status}: ${txt.slice(0, 200)}`); }
  // o Kie devolve erros com HTTP 200 e "code" diferente de 200
  const code = j.code ?? r.status;
  if (code !== 200 || !r.ok) {
    const msg = j.msg || j.message || `erro ${code}`;
    if (code === 401) throw new Error('Chave do Kie.ai inválida (401). Confira em kie.ai → API Key.');
    if (code === 402 || /credit|insufficient|balance/i.test(msg)) throw new Error('Créditos insuficientes no Kie.ai: ' + msg);
    throw new Error(`Kie.ai (${code}): ${msg}`);
  }
  return j.data;
}

/** Saldo em créditos (1 crédito = US$ 0,005). */
export const saldoKie = (chave) => kie(`${API}/api/v1/chat/credit`, chave);

/** Envia um arquivo local e devolve a URL pública temporária (24 h). */
export async function enviarArquivoKie(chave, arquivo) {
  const fd = new FormData();
  const nome = path.basename(arquivo);
  fd.append('file', new Blob([await fs.readFile(arquivo)]), nome);
  fd.append('uploadPath', 'estudio-opus');
  fd.append('fileName', `${Date.now()}-${nome}`);
  const d = await kie(`${UPLOAD}/api/file-stream-upload`, chave, { method: 'POST', body: fd, signal: AbortSignal.timeout(180_000) });
  const url = d?.downloadUrl || d?.fileUrl || d?.url;
  if (!url) throw new Error('O Kie.ai não devolveu a URL da imagem enviada.');
  return url;
}

/**
 * Modelos disponíveis na aba. `montar` recebe { prompt, imagens (URLs), usoImagem, aspecto, duracao, resolucao, audio }
 * e devolve o corpo de /api/v1/jobs/createTask. Preços: estimativa da página de preços do Kie (o custo real é medido pelo saldo).
 */
export const MODELOS_KIE = [
  {
    id: 'veo3_fast', nome: 'Veo 3.1 Fast (Google) — com fala e áudio', grupo: 'Google Veo', duracoes: [8], aspectos: ['9:16', '16:9'],
    resolucoes: ['720p', '1080p'], audioSempre: true, maxImagens: 3, estimativa: 'US$ 0,40 por vídeo (720p)',
    dica: 'Melhor custo-benefício para UGC: pessoa falando, já com voz e som.',
  },
  {
    id: 'veo3_lite', nome: 'Veo 3.1 Lite (Google) — mais barato', grupo: 'Google Veo', duracoes: [8], aspectos: ['9:16', '16:9'],
    resolucoes: ['720p', '1080p'], audioSempre: true, maxImagens: 3, estimativa: 'mais barato que o Fast',
    dica: 'Para testar muitas ideias gastando pouco.',
  },
  {
    id: 'veo3', nome: 'Veo 3.1 Quality (Google) — máxima qualidade', grupo: 'Google Veo', duracoes: [8], aspectos: ['9:16', '16:9'],
    resolucoes: ['720p', '1080p'], audioSempre: true, maxImagens: 2, estimativa: 'US$ 2,00 por vídeo (720p)',
    dica: 'Use na versão final, depois de acertar o prompt no Fast.',
  },
  {
    id: 'kling-3.0/video', nome: 'Kling 3.0', grupo: 'Kling', duracoes: [5, 10, 15], aspectos: ['9:16', '16:9', '1:1'],
    resolucoes: ['std', 'pro'], rotuloResolucao: { std: 'Standard', pro: 'Pro' }, audio: true, maxImagens: 2, estimativa: 'cobrado por segundo',
    dica: 'Movimento de câmera e de produto muito bom.',
  },
  {
    id: 'bytedance/seedance-2-fast', nome: 'Seedance 2.0 Fast (ByteDance)', grupo: 'Seedance', duracoes: [5, 10], aspectos: ['9:16', '16:9', '1:1', '3:4', '4:3'],
    resolucoes: ['720p', '480p'], audio: true, maxImagens: 4, estimativa: 'barato, cobrado por segundo',
    dica: 'Rápido e barato; bom para cenas de produto.',
  },
  {
    id: 'grok-imagine', nome: 'Grok Imagine Video (xAI) — com áudio', grupo: 'Grok', duracoes: [6], aspectos: ['9:16', '16:9', '1:1', '2:3', '3:2'],
    resolucoes: ['720p', '480p', '1080p'], audioSempre: true, maxImagens: 1, estimativa: 'barato',
    dica: 'Gera vídeo com áudio junto, barato.',
  },
];

export function montarTarefa(modelo, o) {
  const imgs = o.imagens || [];
  if (modelo.startsWith('veo3')) {
    const usar = imgs.length ? (o.usoImagem === 'referencia' && modelo !== 'veo3' ? 'REFERENCE_2_VIDEO' : 'FIRST_AND_LAST_FRAMES_2_VIDEO') : 'TEXT_2_VIDEO';
    return {
      model: 'veo-3-1',
      input: {
        prompt: o.prompt, model: modelo, generation_type: usar, aspect_ratio: o.aspecto, resolution: o.resolucao || '720p',
        ...(imgs.length ? { image_urls: imgs.slice(0, usar === 'REFERENCE_2_VIDEO' ? 3 : 2) } : {}),
      },
    };
  }
  if (modelo === 'kling-3.0/video') {
    return {
      model: modelo,
      input: {
        prompt: o.prompt, sound: o.audio !== false, duration: String(o.duracao || 5), aspect_ratio: o.aspecto,
        mode: o.resolucao || 'std', multi_shots: false, ...(imgs.length ? { image_urls: imgs.slice(0, 2) } : {}),
      },
    };
  }
  if (modelo === 'bytedance/seedance-2-fast') {
    const ref = o.usoImagem === 'referencia';
    return {
      model: modelo,
      input: {
        prompt: o.prompt, generate_audio: o.audio !== false, resolution: o.resolucao || '720p', aspect_ratio: o.aspecto, duration: +o.duracao || 5,
        ...(imgs.length && !ref ? { first_frame_url: imgs[0], ...(imgs[1] ? { last_frame_url: imgs[1] } : {}) } : {}),
        ...(imgs.length && ref ? { reference_image_urls: imgs.slice(0, 4) } : {}),
      },
    };
  }
  if (modelo === 'grok-imagine') {
    return imgs.length
      ? { model: 'grok-imagine/image-to-video', input: { prompt: o.prompt, image_urls: imgs.slice(0, 1), mode: 'normal', resolution: o.resolucao || '720p', aspect_ratio: o.aspecto } }
      : { model: 'grok-imagine/text-to-video', input: { prompt: o.prompt, mode: 'normal', resolution: o.resolucao || '720p', aspect_ratio: o.aspecto } };
  }
  throw new Error('Modelo desconhecido: ' + modelo);
}

export async function criarTarefaKie(chave, corpo) {
  const d = await kie(`${API}/api/v1/jobs/createTask`, chave, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  if (!d?.taskId) throw new Error('O Kie.ai não devolveu o número da tarefa.');
  return d.taskId;
}

/** { estado: 'esperando'|'gerando'|'pronto'|'falhou', urls, erro } */
export async function consultarKie(chave, taskId) {
  const d = await kie(`${API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, chave);
  const st = d?.state;
  if (st === 'success') {
    let res = d.resultJson;
    if (typeof res === 'string') { try { res = JSON.parse(res); } catch { res = {}; } }
    const urls = res?.resultUrls || d.resultUrls || [];
    return { estado: 'pronto', urls };
  }
  if (st === 'fail') return { estado: 'falhou', erro: d.failMsg || `falha ${d.failCode || ''}`.trim() };
  return { estado: st === 'generating' ? 'gerando' : 'esperando' };
}

export async function baixar(url, saida, sinal) {
  const r = await fetch(url, { signal: sinal });
  if (!r.ok) throw new Error(`Não consegui baixar o vídeo (${r.status}).`);
  await fs.writeFile(saida, Buffer.from(await r.arrayBuffer()));
}
