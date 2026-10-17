// Sonoplastia cinematográfica com IA: a IA "assiste" ao vídeo (folhas de quadros + análise de
// movimento/cortes + código + locução) e devolve um desenho de som completo, com intenção em cada som.
import { perguntarClaude } from './claude.js';
import { MODOS } from './sintese-tons.js';
import { resumirEventos } from './eventos-visuais.js';

const SISTEMA_SONOPLASTA = `Você é um SOUND DESIGNER de cinema e de trailers (nível Hollywood / grandes agências),
especialista em vídeos curtos para redes sociais e anúncios. Você ASSISTE ao vídeo (folhas de quadros
com o tempo de cada quadro), lê a análise de movimento/cortes e o código da animação, e cria um
DESENHO DE SOM que dá imersão real, com intenção em cada som — nunca efeito genérico repetido.

PRINCÍPIOS QUE VOCÊ SEMPRE SEGUE
1. Sincronia exata: impactos caem no quadro do corte/batida; whooshes acompanham o movimento.
2. Antecipação: risers, reverse swells e sucções TERMINAM exatamente no momento da revelação
   (use "alinhar":"fim" com "inicio" = o instante da revelação).
3. Camadas nos momentos principais: grave (sub/boom) + médio (corpo/punch) + agudo (transiente/ar)
   + cauda (reverb). Use "camadas" para 2 a 4 momentos-chave, não para tudo.
4. Contraste e dinâmica: nem todo corte ganha som; alterne sons grandes e pequenos; crie um
   SILÊNCIO curto (0,2–0,6 s) antes do maior impacto; a intensidade cresce até o clímax.
5. Materialidade: escolha o som pelo que está na tela (interface digital → cliques/glitches suaves;
   metal/cromado → ressonância metálica; líquido → splash; papel → foley de papel; luz/partículas →
   shimmer; tipografia batendo → hits secos; câmera atravessando → whoosh com doppler).
6. Espaço: pan acompanha o lado do movimento (−1 esquerda … +1 direita); reverb maior em impactos
   épicos e logos; cliques, teclas, caneta e papel ficam SECOS (reverb 0), colados no ouvido.
7. Voz manda: durante as falas, só texturas discretas e volumes baixos; impactos fortes nos respiros
   entre as falas. Nunca efeitos com fala, canto ou música.
8. Variedade: nenhuma descrição repetida; se a mesma categoria aparece de novo, mude o timbre
   (ex.: "airy high whoosh" × "heavy low whoosh with sub").
9. Assinatura: o final/logo ganha um STINGER marcante (ex.: shimmer + sub drop + cauda longa).
10. Tátil "quase ASMR" (em QUALQUER estilo): cliques, toques, botões, teclas, digitação, caneta, lápis,
   papel e ticks precisam ser EXTREMAMENTE PRAZEROSOS de ouvir — gravados bem de perto, macios, com
   detalhe tátil nítido mas nunca ásperos ou estridentes, quentes, satisfatórios. Descreva o material
   e o gesto (ex.: "soft thocky mechanical keyboard key press", "felt-tip marker gliding on thick
   paper"), nunca "digital", "harsh", "sharp", "piercing" ou "cinematic" nesses sons. Volume moderado
   (0,25–0,45), reverb 0. Texto sendo escrito/digitado na tela: um som por palavra (ou por tecla nos
   trechos curtos) caindo no instante em que ela aparece — NÃO um "typing burst" genérico.

COMO DESCREVER CADA SOM ("descricao", EM INGLÊS, para um gerador de efeitos de IA)
Seja específico em timbre, peso, textura, envelope e espaço. Exemplos:
- "massive cinematic trailer impact, deep sub boom, metallic transient, long dark reverb tail"
- "fast airy whoosh passing left to right, clean, high frequencies, short"
- "rising tension riser, pitch and white noise sweeping up, ends abruptly on the hit"
- "reverse cymbal swell sucking into a hit"
- "soft satisfying UI tap, rounded and warm, gentle crisp detail, close-mic"
- "single soft thocky mechanical keyboard key press, close-mic ASMR"
- "felt-tip marker gliding smoothly on thick paper, soft tactile texture, close-mic"
- "short digital glitch stutter, data corruption, crunchy"
- "shimmering magical particles sparkle, airy, glassy"
- "elegant sonic logo stinger, bright shimmer with deep sub drop, wide stereo, long tail"
11. Sons de item são AUTOMÁTICOS: cada item que entra/sai/se move já ganha um som do KIT (tons afinados
   numa escala, "tum" grave nos itens grandes, swish nas saídas, tiques na digitação). Em "efeitos" planeje
   SÓ os momentos grandes (cortes, revelações, impactos, risers, o logo). Escolha o KIT coerente com o estilo:
   a escala e o timbre dos tons e as 3 texturas (em inglês), tácteis, macias e satisfatórias.
Nunca peça música, melodia, voz ou palavras.

Responda SOMENTE com um bloco de código json.`;

const SISTEMA_CODIGO = `Você é um sound designer que programa áudio em Web Audio API com qualidade de cinema.
Responda SOMENTE com um bloco de código javascript.`;

function extrairJsonObjeto(texto) {
  const bloco = /```(?:json)?\s*([\s\S]*?)```/i.exec(texto);
  const bruto = bloco ? bloco[1] : texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1);
  try { return JSON.parse(bruto); } catch {}
  throw new Error('A IA não devolveu um plano de som válido. Início: ' + texto.slice(0, 300));
}
function extrairJs(texto) {
  const bloco = /```(?:javascript|js)?\s*([\s\S]*?)```/i.exec(texto);
  const js = (bloco ? bloco[1] : texto).trim();
  if (!/sonorizar/.test(js)) throw new Error('A IA não devolveu a função sonorizar(). Início: ' + texto.slice(0, 300));
  return js;
}

export const CATEGORIAS = ['impacto', 'boom', 'whoosh', 'riser', 'reverse', 'transicao', 'ui', 'glitch', 'textura', 'stinger', 'braam', 'foley', 'hit', 'swell'];
const num = (v, a, b, pad) => Math.min(b, Math.max(a, Number.isFinite(+v) ? +v : pad));

const DENSIDADE = {
  sutil: 'SUTIL: poucos sons e elegantes (cerca de 1 a cada 3 s), sem camadas exageradas.',
  equilibrado: 'EQUILIBRADO: cerca de 1 som a cada 1,6 a 2 s, com 2 a 3 momentos em camadas.',
  intenso: 'INTENSO / TRAILER: cerca de 1 som a cada 1 a 1,2 s, muitos impactos e camadas, energia alta.',
};

/**
 * Planeja a sonoplastia assistindo ao vídeo.
 * analise: resultado de analisarVideo; pastaFolhas: pasta com as folhas de quadros (a IA vê as imagens).
 * Devolve { conceito, ambiente, silencios, efeitos[] }.
 */
export async function planejarSonorizacao({ html, ajustes, analise, pastaFolhas, falas = [], estilo, intensidade = 'equilibrado',
  comAmbiente = true, biblioteca = [], modelo, aoProgresso, sinal }) {
  const duracao = analise?.duracao || ajustes.duracao;
  const L = [];
  L.push(`VÍDEO: ${ajustes.largura}x${ajustes.altura}, ${duracao}s.${ajustes.tema ? ` Tema/marca: ${ajustes.tema}.` : ''}`);
  L.push(`ESTILO SONORO PEDIDO: ${estilo || 'cinematográfico moderno, premium'}.`);
  L.push(`INTENSIDADE: ${DENSIDADE[intensidade] || DENSIDADE.equilibrado}`);
  L.push('');
  L.push(`ASSISTA AO VÍDEO: abra com a ferramenta Read cada folha de quadros desta pasta (${(analise?.folhas || []).join(', ')}).`);
  L.push('Cada quadro tem o tempo (hh:mm:ss.mmm) no canto. Entenda as cenas, o que se move, os materiais, o clima e as revelações.');
  L.push('');
  if (Array.isArray(analise?.eventos)) {
    L.push('ITENS QUE ENTRAM/SAEM (detectados nos quadros):');
    L.push(resumirEventos(analise.eventos, duracao));
    L.push('');
  }
  L.push('ANÁLISE AUTOMÁTICA DO VÍDEO:');
  L.push(analise?.resumo || '(sem análise)');
  L.push('');
  if (falas.length) {
    L.push('LOCUÇÃO (não cubra as palavras; impactos fortes nos respiros):');
    for (const f of falas) L.push(`[${f.inicio.toFixed(2)}–${(f.inicio + (f.duracao || 2)).toFixed(2)}s] ${f.texto}`);
  } else {
    L.push('LOCUÇÃO: nenhuma (o som pode ser mais presente).');
  }
  if (biblioteca.length) {
    L.push('');
    L.push('BIBLIOTECA LOCAL DE SONS (para cada efeito, se houver arquivo adequado, preencha "arquivoBiblioteca" com o nome EXATO; senão null):');
    for (const b of biblioteca) L.push('- ' + b);
  }
  L.push('');
  L.push('CÓDIGO DA ANIMAÇÃO (os tempos exatos das animações estão aqui):');
  L.push('```html');
  L.push(html.length > 60_000 ? html.slice(0, 60_000) + '\n<!-- (cortado) -->' : html);
  L.push('```');
  L.push('');
  L.push('ENTREGUE o plano neste formato JSON:');
  L.push(JSON.stringify({
    conceito: '1–2 frases em português: a ideia sonora do vídeo',
    ambiente: comAmbiente ? { descricao: 'EM INGLÊS: cama sonora contínua e sutil (drone, room tone, atmosfera) sem melodia', volume: 0.15 } : null,
    silencios: [{ inicio: 0, fim: 0 }],
    kit: {
      escala: { tonica: 'C | C# | D | D# | E | F | F# | G | G# | A | A# | B', modo: Object.keys(MODOS).join(' | '), oitava: 5 },
      timbre: 'sine | soft_fm | triangle',
      texturas: { tum: 'EM INGLÊS: soft low felt thump…', saida: 'EM INGLÊS: short soft air swish…', tique: 'EM INGLÊS: tiny soft tactile tick…' },
    },
    efeitos: [{
      inicio: 1.25, alinhar: 'inicio | fim | centro', duracao: 1.2, categoria: CATEGORIAS.join(' | '),
      descricao: 'EM INGLÊS, específico', camadas: ['EM INGLÊS (opcional, só momentos-chave)'],
      volume: 0.8, pan: 0, reverb: 0.3, motivo: 'em português: por que este som aqui', arquivoBiblioteca: null,
    }],
  }, null, 1));
  L.push('Regras: "inicio" em segundos do vídeo; "duracao" entre 0,4 e 8 s (a cauda conta); "volume" 0,1 a 1; "pan" de −1 a 1;');
  L.push('"reverb" de 0 a 1. Com "alinhar":"fim", o som TERMINA em "inicio"; com "centro", o meio do som cai em "inicio". Ordene por tempo.');

  const r = await perguntarClaude({ sistema: SISTEMA_SONOPLASTA, pedido: L.join('\n'), modelo, aoProgresso, sinal, pastaImagens: pastaFolhas });
  const p = extrairJsonObjeto(r.texto);
  const nomes = new Set(biblioteca);
  const efeitos = (Array.isArray(p.efeitos) ? p.efeitos : [])
    .map((e) => ({
      inicio: num(e.inicio, 0, duracao, 0),
      alinhar: ['inicio', 'fim', 'centro'].includes(e.alinhar) ? e.alinhar : 'inicio',
      duracao: num(e.duracao, 0.4, 8, 1.2),
      categoria: CATEGORIAS.includes(e.categoria) ? e.categoria : 'hit',
      descricao: String(e.descricao || '').trim().slice(0, 400),
      camadas: (Array.isArray(e.camadas) ? e.camadas : []).map((c) => String(c).trim().slice(0, 300)).filter(Boolean).slice(0, 3),
      volume: num(e.volume, 0.05, 1.2, 0.8),
      pan: num(e.pan, -1, 1, 0),
      reverb: num(e.reverb, 0, 1, 0.25),
      motivo: String(e.motivo || '').slice(0, 200),
      arquivoBiblioteca: nomes.has(e.arquivoBiblioteca) ? e.arquivoBiblioteca : null,
      variante: 0,
    }))
    .filter((e) => e.descricao)
    .sort((a, b) => a.inicio - b.inicio);
  return {
    conceito: String(p.conceito || '').slice(0, 400),
    ambiente: comAmbiente && p.ambiente?.descricao
      ? { descricao: String(p.ambiente.descricao).slice(0, 400), volume: num(p.ambiente.volume, 0.03, 0.5, 0.15), variante: 0 }
      : null,
    silencios: (Array.isArray(p.silencios) ? p.silencios : [])
      .map((s) => ({ inicio: num(s.inicio, 0, duracao, 0), fim: num(s.fim, 0, duracao, 0) }))
      .filter((s) => s.fim > s.inicio && s.fim - s.inicio <= 2),
    kit: normalizarKit(p.kit),
    efeitos,
  };
}

const TONICAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const TIMBRES = ['sine', 'soft_fm', 'triangle'];
/** Kit de som do vídeo (escala, timbre dos tons e texturas), com valores inválidos trocados pelos padrões. */
export function normalizarKit(bruto) {
  if (!bruto || typeof bruto !== 'object') return null;
  const e = bruto.escala || {};
  const texturas = {};
  for (const k of ['tum', 'saida', 'tique']) {
    const d = String(bruto.texturas?.[k] ?? '').trim().slice(0, 300);
    if (d) texturas[k] = d;
  }
  return {
    escala: {
      tonica: TONICAS.includes(e.tonica) ? e.tonica : 'A',
      modo: MODOS[e.modo] ? e.modo : 'pentatonica_maior',
      oitava: Math.min(6, Math.max(4, Math.round(+e.oitava) || 5)),
    },
    timbre: TIMBRES.includes(bruto.timbre) ? bruto.timbre : 'soft_fm',
    texturas,
  };
}

/** Sonoplastia sintetizada em código (grátis), a partir do plano. Devolve o JS com window.sonorizar(ctx, duracao). */
export async function sintetizarPlanoEmCodigo({ plano, duracao, comTrilha, estilo, modelo, aoProgresso, sinal }) {
  const limpo = {
    ambiente: plano.ambiente,
    silencios: plano.silencios,
    efeitos: plano.efeitos.map((e) => ({ inicio: e.inicio, alinhar: e.alinhar, duracao: e.duracao, categoria: e.categoria, descricao: e.descricao, camadas: e.camadas, volume: e.volume, pan: e.pan, reverb: e.reverb })),
  };
  const L = [
    `Vídeo de ${duracao}s. Estilo: ${estilo || 'cinematográfico moderno'}.`,
    `Conceito sonoro: ${plano.conceito || '-'}`,
    '',
    'PLANO DE SOM (tempos em segundos; "alinhar":"fim" = o som TERMINA em "inicio"; pan de −1 a 1; reverb de 0 a 1):',
    JSON.stringify(limpo, null, 1),
    '',
    'TAREFA: implemente este desenho de som em Web Audio API com qualidade de cinema.',
    'Entregue UM bloco javascript que define:  window.sonorizar = async function (ctx, duracao) { ... }',
    '- ctx é um OfflineAudioContext estéreo 48 kHz com exatamente `duracao` segundos; use tempos absolutos.',
    '- Monte um BUS: cada som → StereoPannerNode (pan do plano) → ganho → master; e um envio para um ConvolverNode',
    '  com resposta ao impulso gerada (ruído estéreo com decaimento exponencial de 1,5 a 3 s, filtrado), proporcional',
    '  ao "reverb". Master: DynamicsCompressorNode suave + limitador, pico final abaixo de −1 dBFS.',
    '- Sintetize cada categoria com técnica de verdade:',
    '  impacto/boom/hit: sub senoidal com queda de pitch (60→35 Hz), corpo de ruído filtrado em banda, transiente',
    '  (clique curto de ruído agudo), leve saturação (WaveShaper) e cauda no reverb;',
    '  whoosh/transicao: ruído rosa em filtro passa-banda com varredura de frequência e envelope em sino;',
    '  riser/swell/reverse: ruído + osciladores desafinados subindo pitch e volume até o fim, com corte seco;',
    '  ui: cliques curtos senoidais/FM agudos; glitch: fragmentos de ruído e ondas quadradas picotados;',
    '  textura/shimmer: várias senoides agudas com tremolo; stinger: acorde brilhante + sub drop;',
    '  braam: dente-de-serra graves desafinados em uníssono com filtro abrindo; foley: ruído moldado ao material.',
    '- Camadas: some as "camadas" no mesmo tempo, cada uma com timbre diferente.',
    '- Ambiente: drone grave suave (osciladores + ruído filtrado com LFO lento), fade in/out, no volume do plano,',
    '  baixando quase a zero dentro dos "silencios".',
    comTrilha ? `- Inclua também uma batida/trilha sintetizada discreta (${estilo || 'moderna'}), abaixo dos efeitos.` : '- Não inclua música.',
    '- Use um PRNG com seed (nada de Math.random) para o resultado ser sempre igual. Sem fetch nem arquivos.',
  ];
  const r = await perguntarClaude({ sistema: SISTEMA_CODIGO, pedido: L.join('\n'), modelo, aoProgresso, sinal });
  return extrairJs(r.texto);
}
