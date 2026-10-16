// Edição IA: o plano de edição (cortes, movimentos da imagem e elementos) pedido ao Claude e validado.
import { perguntarClaude } from '../claude.js';
import { linhaDoTempoDaFala } from '../transcricao.js';
import { estiloPorId } from './estilos.js';

const ESTILO_PADRAO = { paleta: ['#0b0b10', '#7c5cff', '#ffffff'], fonte: 'Inter', clima: '' };
const TIPOS_MOVIMENTO = new Set(['zoom', 'canto', 'meia', 'lado', 'cheia', 'janela']);
const CAMADAS = new Set(['sobre', 'tela-cheia']);
const MAX_ELEMENTOS = 25;
const MAX_MOVIMENTOS = 12;
const MIN_TRECHO = 0.3;
const MIN_FRACAO_MANTIDA = 0.3;

const num = (x) => (Number.isFinite(+x) ? +x : NaN);
const limitar = (x, a, b) => Math.min(b, Math.max(a, x));

function validarManter(manter, duracao, avisos) {
  const trechos = [];
  for (const t of Array.isArray(manter) ? manter : []) {
    let inicio = num(t?.inicio);
    let fim = num(t?.fim);
    if (!Number.isFinite(inicio) || !Number.isFinite(fim)) continue;
    const ci = limitar(inicio, 0, duracao);
    const cf = limitar(fim, 0, duracao);
    if (ci !== inicio || cf !== fim) avisos.push(`Trecho ${inicio}–${fim} s ajustado à duração do vídeo.`);
    [inicio, fim] = [ci, cf];
    if (fim - inicio < MIN_TRECHO) { avisos.push(`Trecho ${inicio}–${fim} s curto demais, ignorado.`); continue; }
    trechos.push({ inicio, fim });
  }
  trechos.sort((a, b) => a.inicio - b.inicio);
  const unidos = [];
  for (const t of trechos) {
    const ult = unidos.at(-1);
    if (ult && t.inicio <= ult.fim) ult.fim = Math.max(ult.fim, t.fim);
    else unidos.push({ ...t });
  }
  if (!unidos.length) throw new Error('O plano não tem nenhum trecho em "manter".');
  const soma = unidos.reduce((s, t) => s + t.fim - t.inicio, 0);
  if (soma < MIN_FRACAO_MANTIDA * duracao) throw new Error(`O plano mantém menos de 30 % do vídeo (${soma.toFixed(1)} de ${duracao.toFixed(1)} s).`);
  return unidos;
}

function validarMovimentos(movimentos, duracao, avisos) {
  const ok = [];
  for (const m of Array.isArray(movimentos) ? movimentos : []) {
    if (!TIPOS_MOVIMENTO.has(m?.tipo)) { avisos.push(`Movimento de tipo desconhecido (${m?.tipo}) ignorado.`); continue; }
    const inicio = limitar(num(m.inicio), 0, duracao);
    const fim = limitar(num(m.fim), 0, duracao);
    if (!(fim > inicio)) continue;
    if (m.tipo === 'janela') {
      // o vídeo da pessoa entra num retângulo (janela de uma interface): sem regiao não dá para posicionar
      if (!m.regiao) { avisos.push('Movimento "janela" sem regiao ignorado.'); continue; }
      ok.push({ ...m, inicio, fim, regiao: limitarRegiao(m.regiao) });
      continue;
    }
    ok.push(inicio === m.inicio && fim === m.fim ? m : { ...m, inicio, fim });
  }
  ok.sort((a, b) => a.inicio - b.inicio);
  if (ok.length > MAX_MOVIMENTOS) avisos.push(`Plano com ${ok.length} movimentos; ficam os ${MAX_MOVIMENTOS} primeiros.`);
  return ok.slice(0, MAX_MOVIMENTOS);
}

function limitarRegiao(r) {
  const x = limitar(num(r.x) || 0, 0, 100);
  const y = limitar(num(r.y) || 0, 0, 100);
  return { x, y, w: limitar(num(r.w) || 0, 0, 100 - x), h: limitar(num(r.h) || 0, 0, 100 - y) };
}

function validarElementos(elementos, manter, avisos, maxElementos = MAX_ELEMENTOS) {
  const ok = [];
  for (const [i, e] of (Array.isArray(elementos) ? elementos : []).entries()) {
    const id = String(e?.id || `e${i + 1}`).replace(/[^\w-]+/g, '_').slice(0, 40) || `e${i + 1}`;
    if (!CAMADAS.has(e?.camada)) { avisos.push(`Elemento ${id}: camada desconhecida (${e?.camada}), ignorado.`); continue; }
    const inicio = num(e.inicio);
    let fim = num(e.fim);
    const trecho = manter.find((t) => inicio >= t.inicio && inicio < t.fim);
    if (!trecho) { avisos.push(`Elemento ${id} começa num trecho cortado e foi descartado.`); continue; }
    if (fim > trecho.fim) { avisos.push(`Elemento ${id} atravessava um corte e foi encurtado.`); fim = trecho.fim; }
    if (!(fim > inicio)) continue;
    const novo = { ...e, id, inicio, fim };
    if (e.camada === 'sobre') {
      const r = e.regiao ? limitarRegiao(e.regiao) : { x: 0, y: 0, w: 100, h: 100 };
      if (!e.regiao || JSON.stringify(r) !== JSON.stringify(e.regiao)) novo.regiao = r;
    }
    ok.push(novo);
  }
  ok.sort((a, b) => a.inicio - b.inicio);
  if (ok.length > maxElementos) avisos.push(`Plano com ${ok.length} elementos; ficam os ${maxElementos} primeiros.`);
  const usados = new Map();
  return ok.slice(0, maxElementos).map((e) => {
    const n = (usados.get(e.id) || 0) + 1;
    usados.set(e.id, n);
    return n === 1 ? e : { ...e, id: `${e.id}-${n}` };
  });
}

/** Confere e conserta o plano. Lança se não sobrar nada utilizável em "manter". */
export function validarPlano(bruto, { duracao, estiloEdicao } = {}) {
  if (!bruto || typeof bruto !== 'object') throw new Error('O plano não é um objeto JSON.');
  const avisos = [];
  // com um estilo de edição escolhido, a paleta e o limite de elementos são os dele
  const preset = estiloEdicao ? estiloPorId(estiloEdicao) : null;
  const manter = validarManter(bruto.manter, duracao, avisos);
  const plano = {
    ...bruto,
    estilo: preset?.estilo ? { ...preset.estilo } : bruto.estilo && typeof bruto.estilo === 'object' ? bruto.estilo : { ...ESTILO_PADRAO },
    manter,
    movimentos: validarMovimentos(bruto.movimentos, duracao, avisos),
    elementos: validarElementos(bruto.elementos, manter, avisos, preset ? Math.min(MAX_ELEMENTOS, preset.maxElementos(duracao)) : MAX_ELEMENTOS),
  };
  return { plano, avisos };
}

/** Primeiro bloco ```json``` ou, se não houver, do primeiro "{" ao último "}". */
export function extrairJson(texto) {
  const cercado = /```(?:json)?\s*([\s\S]*?)```/i.exec(texto);
  if (cercado) return JSON.parse(cercado[1]);
  const a = texto.indexOf('{');
  const b = texto.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('A resposta não trouxe JSON.');
  return JSON.parse(texto.slice(a, b + 1));
}

const SISTEMA_PLANO = `Você é um editor de vídeo de alto nível para Reels, TikTok e anúncios verticais (9:16).
Recebe um vídeo de uma pessoa falando para a câmera e cria o PLANO DE EDIÇÃO: o que cortar, como mexer na imagem
da pessoa e quais elementos animados criar, sincronizados com o que ela diz.

Você tem LIBERDADE CRIATIVA TOTAL. Prenda a atenção do começo ao fim: surpresas visuais, ritmo, elementos que
ilustram, explicam e reforçam cada ideia (textos, títulos 3D, ícones, listas, números, gráficos, objetos e cenas 3D,
telas explicativas em tela cheia, chamada final). Qualidade de edição profissional.

Responda SÓ com um JSON neste formato (sem comentários):
{
  "estilo": { "paleta": ["#hex", "#hex", "#hex"], "fonte": "nome da Google Font", "clima": "frase curta" },
  "manter": [ { "inicio": 0.42, "fim": 6.10 } ],
  "movimentos": [
    { "inicio": 3.1, "fim": 3.9, "tipo": "zoom", "escala": 1.25 },
    { "inicio": 9.0, "fim": 13.5, "tipo": "canto", "canto": "inferior-esquerdo", "escala": 0.38 },
    { "inicio": 15, "fim": 18, "tipo": "meia", "lado": "inferior" },
    { "inicio": 20, "fim": 22, "tipo": "lado", "direcao": "esquerda", "deslocamento": 20 }
  ],
  "elementos": [
    { "id": "e1", "inicio": 9.0, "fim": 13.5, "camada": "tela-cheia", "regiao": null, "ancora": null,
      "descricao": "o que aparece e como se move, em detalhe", "textoNaTela": "4× MAIS" },
    { "id": "e2", "inicio": 2.8, "fim": 4.4, "camada": "sobre", "regiao": { "x": 8, "y": 10, "w": 84, "h": 22 },
      "ancora": null, "descricao": "...", "textoNaTela": "ATENÇÃO" }
  ]
}

Regras técnicas (as únicas):
- Tempos em segundos na linha do tempo ORIGINAL (antes dos cortes).
- "manter" são os trechos que ficam: tire pausas longas, vícios de fala e frases repetidas ou erradas (quando a pessoa
  repete, fica a ÚLTIMA versão). Não mude a ordem nem o sentido do que foi dito.
- Cada elemento começa e termina DENTRO de um único trecho de "manter".
- "camada": "sobre" (por cima da pessoa, numa "regiao" em % da tela) ou "tela-cheia" (cobre a tela; para a pessoa
  continuar visível, use junto um movimento "canto").
- "movimentos.tipo": zoom (escala), canto (canto: superior-esquerdo|superior-direito|inferior-esquerdo|inferior-direito,
  escala), meia (lado: superior|inferior), lado (direcao: esquerda|direita, deslocamento em %), cheia (volta ao normal),
  janela (regiao: { x, y, w, h } em % — o vídeo da pessoa encolhe para dentro desse retângulo, ex.: janela de uma interface).
- O elemento entra NA palavra a que se refere (±0,15 s).
- Texto importante fora da faixa inferior (últimos 22 % da altura) e da coluna direita (últimos 18 % da largura),
  onde ficam os botões do Reels. Texto grande o bastante para ler no celular.
- Até ${MAX_ELEMENTOS} elementos e ${MAX_MOVIMENTOS} movimentos.`;

/** Texto do pedido do plano (sem o sistema). */
export function montarPedidoPlano({ transcricao, candidatos = [], segmentos = [], duracao, briefing = '', folhas = [], estiloEdicao }) {
  const preset = estiloEdicao ? estiloPorId(estiloEdicao) : null;
  return [
    `Duração do vídeo: ${duracao.toFixed(2)} s. Formato 1080×1920 (9:16).`,
    segmentos.length > 1
      ? `O vídeo junta ${segmentos.length} gravações, nesta ordem: ${segmentos.map((s, i) => `${i + 1}) ${s.inicio.toFixed(2)}–${s.fim.toFixed(2)} s`).join(', ')}.`
      : '',
    'O CONTEÚDO DA EDIÇÃO VEM DO QUE A PESSOA FALA: cada título, card, tela e movimento ilustra a frase dita naquele momento '
      + '(use as palavras dela nos títulos). Leia a fala inteira antes, entenda o assunto e construa o vídeo em cima dela.',
    briefing.trim() ? `Observações da pessoa (complemento; se não combinarem com a fala, siga a fala):\n${briefing.trim()}` : '',
    preset?.regrasPlano ? `\n${preset.regrasPlano}\nMáximo de elementos neste vídeo: ${preset.maxElementos(duracao)}.` : '',
    '',
    linhaDoTempoDaFala(transcricao),
    '',
    candidatos.length
      ? `Candidatos a corte já detectados (silêncios e vícios; decida você): ${candidatos.map((c) => `${c.inicio.toFixed(2)}–${c.fim.toFixed(2)} (${c.motivo})`).join(', ')}`
      : 'Nenhum silêncio longo detectado.',
    '',
    folhas.length
      ? `Use a ferramenta Read para ver as folhas de quadros (${folhas.join(', ')}): cada uma mostra quadros do vídeo com o tempo em segundos. Veja o enquadramento, onde ficam o rosto e as mãos, e o fundo.`
      : '',
    '',
    'Responda só com o JSON do plano.',
  ].filter((l) => l !== '').join('\n');
}

/** Pede o plano ao Claude e valida; uma nova tentativa automática com o erro anexado. */
export async function pedirPlano({ pastaQuadros, modelo, aoProgresso, sinal, ...entrada }) {
  const { estiloEdicao } = entrada;
  const pedidoBase = montarPedidoPlano(entrada);
  let custo = 0;
  let erroAnterior = null;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const pedido = erroAnterior
      ? `${pedidoBase}\n\nSUA RESPOSTA ANTERIOR FOI RECUSADA: ${erroAnterior}\nResponda de novo, só com o JSON válido.`
      : pedidoBase;
    const r = await perguntarClaude({ sistema: SISTEMA_PLANO, pedido, modelo, pastaImagens: pastaQuadros, aoProgresso, sinal });
    custo += r.custo || 0;
    try {
      const { plano, avisos } = validarPlano(extrairJson(r.texto), { duracao: entrada.duracao, estiloEdicao });
      return { plano, avisos, custo };
    } catch (e) {
      if (sinal?.aborted) throw e;
      erroAnterior = e.message;
    }
  }
  throw new Error(`O Claude não devolveu um plano válido: ${erroAnterior}`);
}
