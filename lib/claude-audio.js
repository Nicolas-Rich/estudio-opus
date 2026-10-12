// Pedidos ao Claude para a parte sonora: roteiro de locução, mapa de efeitos
// (momentos da animação que pedem som) e efeitos sintetizados em código (WebAudio).
import { perguntarClaude } from './claude.js';

const SISTEMA_AUDIO = `Você é um sound designer e roteirista de vídeos curtos para redes sociais e anúncios.
Você recebe o código-fonte de uma animação (HTML/JS) que vira vídeo. Leia o código com atenção
para descobrir a LINHA DO TEMPO real: constantes de duração, keyframes, timelines GSAP,
setTimeout, cenas, quando cada texto entra e sai, quando há impactos, transições, explosões,
trocas de cena. Seus tempos devem bater com o que acontece na tela.
Responda exatamente no formato pedido, sem comentários fora do bloco.`;

function extrairJson(texto) {
  const bloco = /```(?:json)?\s*([\s\S]*?)```/i.exec(texto);
  const bruto = bloco ? bloco[1] : texto.slice(texto.indexOf('['), texto.lastIndexOf(']') + 1);
  try {
    const v = JSON.parse(bruto);
    if (Array.isArray(v)) return v;
  } catch {}
  throw new Error('O Claude não devolveu uma lista JSON válida. Início: ' + texto.slice(0, 300));
}

function extrairJs(texto) {
  const bloco = /```(?:javascript|js)?\s*([\s\S]*?)```/i.exec(texto);
  const js = (bloco ? bloco[1] : texto).trim();
  if (!/sonorizar/.test(js)) throw new Error('O Claude não devolveu a função sonorizar(). Início: ' + texto.slice(0, 300));
  return js;
}

const cabecalho = (html, ajustes) => [
  `Vídeo: ${ajustes.largura}×${ajustes.altura}, duração ${ajustes.duracao}s.`,
  ajustes.tema ? `Tema/marca: ${ajustes.tema}` : '',
  ajustes.textos ? `Textos previstos: ${ajustes.textos}` : '',
  '',
  'Código da animação:',
  '```html',
  html.length > 120_000 ? html.slice(0, 120_000) + '\n<!-- (cortado) -->' : html,
  '```',
].filter((l) => l !== '').join('\n');

/** Roteiro de locução cronometrado: [{ inicio, texto }] */
export async function escreverRoteiro({ html, ajustes, tom, instrucoes, idioma, modelo, aoProgresso, sinal }) {
  const pedido = [
    cabecalho(html, ajustes),
    '',
    'TAREFA: escreva a LOCUÇÃO (voz off) deste vídeo.',
    `- Idioma: ${idioma || ajustes.idioma || 'Português do Brasil'}. Linguagem natural, falada, sem siglas difíceis.`,
    `- Tom: ${tom || 'confiante, energético, de anúncio'}.`,
    instrucoes ? `- Instruções: ${instrucoes}` : '',
    '- Divida em falas curtas; cada fala começa no segundo em que o assunto dela aparece na tela.',
    '- Ritmo de fala ≈ 2,5 palavras por segundo: cada fala deve TERMINAR antes do início da próxima',
    `  e a última deve terminar antes de ${ajustes.duracao}s. Deixe respiros; não precisa narrar tudo.`,
    '- Escreva números por extenso quando ajudar a pronúncia (ex.: "trinta gramas").',
    '',
    'Responda SOMENTE com um bloco ```json contendo uma lista: [{"inicio": 0.4, "texto": "..."}]',
  ].filter(Boolean).join('\n');
  const r = await perguntarClaude({ sistema: SISTEMA_AUDIO, pedido, modelo, aoProgresso, sinal });
  return extrairJson(r.texto)
    .map((f) => ({ inicio: Math.max(0, +f.inicio || 0), texto: String(f.texto || '').trim() }))
    .filter((f) => f.texto)
    .sort((a, b) => a.inicio - b.inicio);
}

/**
 * Mapa de efeitos: [{ inicio, duracao, descricao, volume, arquivoBiblioteca? }]
 * `descricao` vem em inglês (é o prompt usado no gerador de efeitos).
 * Se `biblioteca` (lista de nomes de arquivo) vier preenchida, o Claude escolhe um arquivo por momento.
 */
export async function mapearEfeitos({ html, ajustes, estilo, biblioteca, modelo, aoProgresso, sinal }) {
  const pedido = [
    cabecalho(html, ajustes),
    '',
    'TAREFA: faça o mapa de EFEITOS SONOROS (sound design) deste vídeo.',
    `- Estilo: ${estilo || 'moderno, impactante, limpo, de anúncio'}.`,
    '- Marque os momentos que pedem som: entradas de texto, cortes/transições (whoosh), impactos (hit/boom),',
    '  partículas (shimmer), cliques de UI, risers antes de revelações, logo final (sting).',
    '- Não exagere: entre 4 e 14 efeitos para até 15s; som só onde há ação visível.',
    '- "duracao" em segundos (0.5 a 6). "volume" de 0.2 a 1 (efeitos de fundo mais baixos).',
    '- "descricao": prompt curto EM INGLÊS para um gerador de efeitos sonoros, específico',
    '  (ex.: "deep cinematic whoosh transition, fast", "punchy sub bass impact hit", "soft digital UI click").',
    biblioteca?.length
      ? `- Existe uma biblioteca local de sons. Para cada efeito, se houver um arquivo adequado, preencha
  "arquivoBiblioteca" com o nome EXATO de um destes arquivos (senão use null):\n${biblioteca.map((b) => '  • ' + b).join('\n')}`
      : '',
    '',
    'Responda SOMENTE com um bloco ```json:',
    '[{"inicio": 0.0, "duracao": 1.2, "descricao": "...", "volume": 0.8, "arquivoBiblioteca": null}]',
  ].filter(Boolean).join('\n');
  const r = await perguntarClaude({ sistema: SISTEMA_AUDIO, pedido, modelo, aoProgresso, sinal });
  const nomes = new Set(biblioteca || []);
  return extrairJson(r.texto)
    .map((e) => ({
      inicio: Math.max(0, +e.inicio || 0),
      duracao: Math.min(30, Math.max(0.5, +e.duracao || 1)),
      descricao: String(e.descricao || '').trim(),
      volume: Math.min(1.5, Math.max(0.05, +e.volume || 0.8)),
      arquivoBiblioteca: nomes.has(e.arquivoBiblioteca) ? e.arquivoBiblioteca : null,
    }))
    .filter((e) => e.descricao)
    .sort((a, b) => a.inicio - b.inicio);
}

/** Efeitos sintetizados em código: devolve o JS com window.sonorizar(ctx, duracao). */
export async function sintetizarEfeitosEmCodigo({ html, ajustes, efeitos, comTrilha, estilo, modelo, aoProgresso, sinal }) {
  const pedido = [
    cabecalho(html, ajustes),
    '',
    'Mapa de efeitos (segundos):',
    '```json',
    JSON.stringify(efeitos, null, 1),
    '```',
    '',
    'TAREFA: escreva o sound design deste vídeo como código Web Audio API puro.',
    'Entregue UM bloco ```javascript que define:',
    '  window.sonorizar = async function (ctx, duracao) { ... }',
    '- ctx é um OfflineAudioContext estéreo de 48 kHz com exatamente `duracao` segundos.',
    '- Agende tudo com tempos absolutos (ctx.currentTime é 0) e conecte em ctx.destination.',
    '- Sintetize cada efeito do mapa no tempo indicado: osciladores, ruído (AudioBuffer com Math.random),',
    '  filtros com envelopes, distorção (WaveShaper), reverb (ConvolverNode com impulso gerado), panning.',
    '  Faça sons ricos e profissionais (whoosh com ruído filtrado em varredura, impacto com sub + click +',
    '  cauda, riser com pitch subindo, shimmer com senoides agudas, etc.). Respeite o "volume" de cada um.',
    comTrilha
      ? `- Inclua também uma TRILHA de fundo sintetizada (${estilo || 'beat moderno de anúncio'}), BPM coerente com o ritmo dos cortes,\n  mais baixa que os efeitos, com início e final limpos.`
      : '- Não inclua música de fundo, só os efeitos.',
    '- Use um compressor/limitador (DynamicsCompressorNode) no master e evite clipping.',
    '- Sem arquivos externos, sem fetch, sem bibliotecas. Determinístico (use um PRNG com seed em vez de Math.random se preferir).',
  ].join('\n');
  const r = await perguntarClaude({ sistema: SISTEMA_AUDIO, pedido, modelo, aoProgresso, sinal });
  return extrairJs(r.texto);
}
