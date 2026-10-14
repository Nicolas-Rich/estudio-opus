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

/** Roteiro de locução cronometrado: [{ inicio, fim, texto }].
 *  A IA vê o vídeo (folhas de quadros + análise) e escreve cada fala dentro do limite de palavras da janela. */
export async function escreverRoteiro({ html, ajustes, tom, instrucoes, idioma, modelo, aoProgresso, sinal, analise, pastaFolhas, velocidade = 1 }) {
  // ritmo real de locução em português: ~2,4 palavras/s a 1×; o limite acompanha a velocidade escolhida
  const ritmo = 2.2 * Math.min(1.3, Math.max(0.7, velocidade || 1)); // palavras por segundo, com margem
  const pps = ritmo.toFixed(1);
  const duracao = analise?.duracao || ajustes.duracao;
  const pedido = [
    cabecalho(html, ajustes),
    '',
    analise ? `ASSISTA AO VÍDEO: abra com a ferramenta Read cada folha de quadros (${analise.folhas.join(', ')}). Cada quadro mostra o tempo no canto.` : '',
    analise ? `ANÁLISE DO VÍDEO:\n${analise.resumo}` : '',
    '',
    'TAREFA: escreva a LOCUÇÃO (voz off) deste vídeo, sincronizada com o que aparece na tela.',
    `- Idioma: ${idioma || ajustes.idioma || 'Português do Brasil'}. Linguagem natural, falada, frases curtas e fortes, sem siglas difíceis.`,
    `- Tom: ${tom || 'confiante, energético, de anúncio'}.`,
    instrucoes ? `- Instruções do usuário: ${instrucoes}` : '',
    '- Cada fala tem uma JANELA: "inicio" = quando o assunto aparece na tela; "fim" = quando a fala precisa ter acabado',
    '  (antes da próxima fala começar ou da próxima cena mudar de assunto).',
    `- LIMITE DE PALAVRAS POR FALA = (fim − inicio) × ${pps}. Conte as palavras e respeite. É melhor falar menos que atropelar.`,
    '- Entre o "fim" de uma fala e o "inicio" da próxima deixe pelo menos 0,25 s de respiro. Nunca sobreponha janelas.',
    `- A última fala termina antes de ${(duracao - 0.3).toFixed(1)} s. Não precisa narrar tudo: os textos da tela e os momentos de impacto podem respirar.`,
    '- Não leia literalmente todos os textos da tela; complemente-os (a voz vende, a tela mostra).',
    '- Escreva números, preços e porcentagens por extenso (ex.: "noventa e sete reais", "trinta por cento").',
    '- Termine com uma chamada para ação clara se o vídeo for um anúncio.',
    '',
    'Responda SOMENTE com um bloco ```json contendo uma lista: [{"inicio": 0.4, "fim": 2.1, "texto": "..."}]',
  ].filter(Boolean).join('\n');
  const r = await perguntarClaude({ sistema: SISTEMA_AUDIO, pedido, modelo, aoProgresso, sinal, pastaImagens: pastaFolhas });
  const falas = extrairJson(r.texto)
    .map((f) => ({ inicio: Math.max(0, +f.inicio || 0), fim: +f.fim || 0, texto: String(f.texto || '').trim() }))
    .filter((f) => f.texto)
    .sort((a, b) => a.inicio - b.inicio);
  // garante janelas sem sobreposição
  falas.forEach((f, i) => {
    const prox = falas[i + 1]?.inicio ?? duracao;
    if (!(f.fim > f.inicio) || f.fim > prox - 0.2) f.fim = Math.max(f.inicio + 0.6, prox - 0.25);
    f.fim = +f.fim.toFixed(2);
  });
  // confere a contagem de palavras; falas que não cabem voltam para a IA encurtar
  const palavras = (t) => t.split(/\s+/).filter(Boolean).length;
  const limite = (f) => Math.max(2, Math.floor((f.fim - f.inicio) * ritmo));
  const longas = falas.map((f, i) => ({ i, texto: f.texto, palavras: palavras(f.texto), max: limite(f) })).filter((x) => x.palavras > x.max);
  if (longas.length) {
    aoProgresso?.(0, `${longas.length} fala(s) longas demais para o tempo — pedindo para encurtar…`);
    const pedido2 = [
      'Estas falas de uma locução ficaram LONGAS DEMAIS para o tempo disponível. Reescreva cada uma com NO MÁXIMO o',
      'número de palavras indicado, mantendo o sentido, a força e o tom. Prefira frases curtas e impactantes.',
      JSON.stringify(longas.map(({ i, texto, max }) => ({ i, texto, maxPalavras: max })), null, 1),
      'Responda SOMENTE com um bloco ```json: [{"i": 0, "texto": "..."}]',
    ].join('\n');
    try {
      const r2 = await perguntarClaude({ sistema: SISTEMA_AUDIO, pedido: pedido2, modelo, sinal });
      for (const c of extrairJson(r2.texto)) {
        const f = falas[+c.i];
        if (f && String(c.texto || '').trim()) f.texto = String(c.texto).trim();
      }
    } catch { /* se falhar, o organizador da voz ainda evita sobreposição */ }
  }
  return falas;
}

/**
 * Estúdio de voz: roteiro CONTÍNUO (uma locução inteira, gerada de uma vez só na ElevenLabs),
 * com direção de voz e tags de emoção. Devolve { direcao, opcoes: [{ titulo, texto }] }.
 */
export async function escreverLocucao({ html, ajustes, analise, pastaFolhas, briefing, tom, cta, publico, comTags = true, velocidade = 1, alvoPalavras, duracaoFala, livre = false, idioma, modelo, aoProgresso, sinal }) {
  const duracao = analise?.duracao || ajustes.duracao;
  const ritmo = 2.3 * Math.min(1.2, Math.max(0.7, velocidade || 1));
  const alvo = alvoPalavras || Math.max(4, Math.round((duracao - 0.6) * ritmo));
  const segFala = duracaoFala || alvo / ritmo;
  const pedido = [
    cabecalho(html, ajustes),
    '',
    analise ? `ASSISTA AO VÍDEO: abra com a ferramenta Read cada folha de quadros (${analise.folhas.join(', ')}). Cada quadro mostra o tempo no canto.` : '',
    analise ? `ANÁLISE DO VÍDEO:\n${analise.resumo}` : '',
    '',
    'TAREFA: você é um redator de locução publicitária. Escreva a LOCUÇÃO (voz off) deste vídeo como UM TEXTO CORRIDO,',
    'que será gravado de uma vez só por uma voz da ElevenLabs (por isso precisa soar natural do começo ao fim).',
    `- Idioma: ${idioma || ajustes.idioma || 'Português do Brasil'}, falado e natural, como um locutor brasileiro de verdade.`,
    briefing ? `- Sobre o que falar / produto / mensagem: ${briefing}` : '- Descubra a mensagem pelo que aparece na tela.',
    `- Tom: ${tom || 'confiante e envolvente, de anúncio'}.`,
    publico ? `- Público: ${publico}.` : '',
    cta ? `- Chamada para ação final: ${cta}.` : '- Termine com uma chamada para ação clara se for um anúncio.',
    livre
      ? `- TAMANHO: a locução deve durar cerca de ${Math.round(segFala)} s, ou seja, por volta de ${alvo} palavras (sem contar as tags; pode variar uns 10%). O vídeo tem ${duracao.toFixed(1)} s e será ajustado ao tempo da voz depois, então desenvolva o assunto com calma e profundidade, distribuindo o texto pela ordem das cenas.`
      : `- TAMANHO: o vídeo tem ${duracao.toFixed(1)} s. Escreva ENTRE ${Math.round(alvo * 0.85)} E ${alvo} palavras (sem contar as tags), para a voz ocupar o vídeo inteiro sem atropelar.`,
    livre
      ? '- Siga a ordem do que aparece na tela. Use quebras de linha (parágrafos) entre os blocos de assunto.'
      : '- Acompanhe a ordem do que aparece na tela: cada frase entra quando o assunto dela aparece. Use quebras de linha entre os blocos de cena.',
    '- Ritmo pela pontuação: vírgulas e pontos para respirar, reticências (…) para suspense, travessão para ênfase. Frases curtas e fortes.',
    `- Use MUITAS frases curtas (mais ou menos uma frase a cada ${Math.max(6, Math.round(ritmo * 3))} palavras), em vez de poucas frases longas: assim a voz acompanha cada cena e o encaixe no vídeo fica preciso.`,
    '- Números, preços e porcentagens por extenso ("noventa e sete reais", "trinta por cento"). Sem siglas difíceis, sem emojis.',
    comTags
      ? '- Use TAGS DE EMOÇÃO da ElevenLabs entre colchetes, EM INGLÊS, com moderação (2 a 5 a cada minuto de fala), antes da frase que afetam: '
        + '[excited], [confident], [warm], [serious], [whispers], [curious], [short pause], [long pause], [laughs softly], [dramatic].'
      : '- NÃO use tags entre colchetes.',
    '- Não leia literalmente todos os textos da tela; complemente-os (a voz vende, a tela mostra).',
    '',
    'Entregue 3 OPÇÕES diferentes de abordagem (ex.: direta, emocional, curiosidade) e uma DIREÇÃO DE VOZ curta',
    '(como orientar o locutor: energia, velocidade, sorriso na voz, onde enfatizar).',
    'Responda SOMENTE com um bloco ```json: {"direcao": "...", "opcoes": [{"titulo": "Direta", "texto": "..."}]}',
  ].filter(Boolean).join('\n');
  const r = await perguntarClaude({ sistema: SISTEMA_AUDIO, pedido, modelo, aoProgresso, sinal, pastaImagens: pastaFolhas });
  const bloco = /```(?:json)?\s*([\s\S]*?)```/i.exec(r.texto);
  const bruto = bloco ? bloco[1] : r.texto.slice(r.texto.indexOf('{'), r.texto.lastIndexOf('}') + 1);
  let v;
  try { v = JSON.parse(bruto); } catch { throw new Error('A IA não devolveu o roteiro no formato esperado. Tente de novo.'); }
  const opcoes = (v.opcoes || []).map((o) => ({ titulo: String(o.titulo || 'Opção').trim(), texto: String(o.texto || '').trim() })).filter((o) => o.texto);
  if (!opcoes.length) throw new Error('A IA não devolveu nenhum roteiro. Tente de novo.');
  return { direcao: String(v.direcao || '').trim(), opcoes, alvoPalavras: alvo, duracao };
}

/**
 * Encaixe de uma locução já gravada no vídeo: cada bloco (frase gravada, com duração fixa) recebe
 * o segundo em que deve começar — quando o assunto dele aparece na tela. Devolve [{ i, inicio }].
 */
export async function encaixarFalas({ html, ajustes, analise, pastaFolhas, blocos, modelo, aoProgresso, sinal }) {
  const duracao = analise?.duracao || ajustes.duracao;
  const total = blocos.reduce((s, b) => s + b.dur, 0);
  const pedido = [
    cabecalho(html, ajustes),
    '',
    analise ? `ASSISTA AO VÍDEO: abra com a ferramenta Read cada folha de quadros (${analise.folhas.join(', ')}). Cada quadro mostra o tempo no canto.` : '',
    analise ? `ANÁLISE DO VÍDEO:\n${analise.resumo}` : '',
    '',
    `TAREFA: uma locução JÁ GRAVADA tem ${total.toFixed(1)} s de fala e o vídeo tem ${duracao.toFixed(1)} s.`,
    'Ela foi cortada em blocos (frases). A duração de cada bloco é fixa. Decida em que segundo do vídeo cada bloco começa,',
    'para a voz falar de cada assunto QUANDO ele aparece na tela e a locução ocupar o vídeo de forma natural.',
    '- Mantenha a ordem dos blocos. Nunca sobreponha: inicio[i] ≥ inicio[i−1] + dur[i−1] + 0.15.',
    `- O último bloco deve terminar até ${(duracao - 0.3).toFixed(1)} s.`,
    '- Comece a primeira fala entre 0 e 1,5 s (o gancho precisa de voz cedo), a não ser que a tela peça silêncio.',
    '- Use as pausas a favor: deixe respiros em cortes de cena e revelações; a chamada final perto do fim, quando aparece o logo/CTA.',
    '',
    'Blocos:',
    ...blocos.map((b) => `${b.i}. (${b.dur.toFixed(2)} s) ${b.texto}`),
    '',
    'Responda SOMENTE com um bloco ```json: [{"i": 0, "inicio": 0.4}, ...]',
  ].filter(Boolean).join('\n');
  const r = await perguntarClaude({ sistema: SISTEMA_AUDIO, pedido, modelo, aoProgresso, sinal, pastaImagens: pastaFolhas });
  return extrairJson(r.texto).map((x) => ({ i: +x.i, inicio: +x.inicio })).filter((x) => Number.isFinite(x.i) && Number.isFinite(x.inicio));
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
