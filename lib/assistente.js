// Assistente de criação: transforma uma ideia solta num prompt completo de animação
// (no estilo dos prompts do awesome-opus5-5-videos) e sugere instruções extras.
import { perguntarClaude, blocoImagens } from './claude.js';

const SISTEMA = `Você é diretor de criação e prompt engineer especialista em vídeos de motion design
feitos com código (HTML, Canvas, SVG, Three.js, GSAP, shaders) pelo Claude.
Você escreve prompts que geram vídeos virais e anúncios de alta conversão: gancho forte nos
primeiros 2 segundos, ritmo, hierarquia tipográfica, paleta definida, cenas descritas com
tempos, movimentos de câmera, transições e um final marcante.
Responda SOMENTE com o texto pedido, sem comentários, sem markdown de título e sem aspas em volta.`;

function contexto(ajustes = {}) {
  return [
    `Formato: ${ajustes.formatoNome || `${ajustes.largura}×${ajustes.altura}`} · duração ${ajustes.duracao || 10}s.`,
    ajustes.idioma ? `Idioma dos textos na tela: ${ajustes.idioma}.` : '',
    ajustes.tema ? `Tema / marca / produto: ${ajustes.tema}` : '',
    ajustes.textos ? `Textos obrigatórios: ${ajustes.textos}` : '',
    ajustes.cores ? `Paleta / identidade: ${ajustes.cores}` : '',
  ].filter(Boolean).join('\n');
}

/** Ideia → prompt completo. `referencias` são prompts do repositório usados como exemplo de estilo. */
export async function gerarPromptDeIdeia({ ideia, ajustes, modeloBase, referencias = [], modelo, sinal, imagens = [], pastaImagens }) {
  const pedido = [
    'Escreva o PROMPT de uma animação a partir da ideia abaixo.',
    '',
    'IDEIA DO USUÁRIO:',
    ideia.trim() || '(sem ideia escrita: proponha a melhor ideia para o tema)',
    '',
    contexto(ajustes),
    modeloBase ? `\nPROMPT-MODELO ESCOLHIDO (mantenha o estilo/técnica dele, adaptando à ideia):\n${modeloBase}` : '',
    referencias.length ? `\nEXEMPLOS DE PROMPTS QUE GERARAM VÍDEOS VIRAIS (use como referência de nível de detalhe e estilo):\n${referencias.map((r, i) => `--- exemplo ${i + 1} ---\n${r}`).join('\n')}` : '',
    '',
    'O PROMPT DEVE:',
    '- Ser escrito em português, direto, como instrução para um motion designer de elite.',
    '- Descrever o conceito, o estilo visual (referências, texturas, iluminação, tipografia), a paleta,',
    '  e a sequência de CENAS com tempos aproximados (ex.: 0–2s gancho…), movimentos, transições e o final.',
    '- Indicar a técnica (Canvas, SVG, Three.js, GSAP, shaders) quando fizer diferença.',
    imagens.length ? blocoImagens(imagens) + '\n- No prompt, cite cada ELEMENTO pelo nome do arquivo (assets/...) e descreva onde e como ele aparece; descreva o estilo das REFERÊNCIAS em palavras.' : '',
    '- Ter entre 120 e 350 palavras. Sem pedir áudio, botões/controles, arquivos externos ou ferramentas fora do navegador.',
    `- Usar a duração informada (${ajustes?.duracao || 10}s) para distribuir as cenas.`,
  ].filter((l) => l !== '').join('\n');
  const r = await perguntarClaude({ sistema: SISTEMA, pedido, modelo, sinal, timeoutMs: 5 * 60_000, pastaImagens });
  return limpar(r.texto);
}

/**
 * Pedido para escrever o prompt de uma animação que vai POR CIMA do vídeo da pessoa,
 * construída a partir do que ela fala (com tempos) e do que aparece nos quadros.
 */
export function montarPedidoDoVideo({ transcricao, folhas = [], largura, altura, duracao, ideia = '' }) {
  const t = (x) => (+x).toFixed(2);
  return [
    'Escreva o PROMPT de uma animação que vai POR CIMA do vídeo abaixo: uma pessoa falando para a câmera.',
    'A animação é renderizada com fundo transparente e colocada sobre o vídeo; ela ilustra e reforça o que a pessoa',
    'está dizendo, no tempo exato em que diz.',
    '',
    `Vídeo: ${largura}×${altura} px, ${(+duracao).toFixed(1)} s.`,
    '',
    'O QUE A PESSOA FALA (segundos no vídeo):',
    ...(transcricao?.frases || []).map((f) => `[${t(f.inicio)}–${t(f.fim)}] ${f.texto}`),
    '',
    folhas.length
      ? `Use a ferramenta Read para ver as folhas de quadros do vídeo (${folhas.join(', ')}): cada uma mostra quadros com o tempo. `
        + 'Veja onde fica o rosto, o enquadramento, as cores e o espaço livre para os elementos.'
      : '',
    ideia.trim() ? `\nObservações da pessoa (complemento; se não combinarem com a fala, siga a fala):\n${ideia.trim()}` : '',
    '',
    'O PROMPT DEVE:',
    '- Ser escrito em português, como instrução para um motion designer de elite.',
    '- Partir do conteúdo da fala: listar, em ordem, os momentos que ganham um elemento, com o tempo de entrada na',
    '  palavra (ex.: "em 3.0s, na palavra IA: …") e o texto que aparece, usando as palavras da pessoa.',
    '- Definir um estilo visual único (paleta, tipografia, tipo de movimento) que combine com o vídeo e o assunto.',
    '- Respeitar o rosto: nada sobre o rosto da pessoa; títulos no topo, cards nas laterais, nada nos 22% de baixo.',
    '- Ter contenção: um elemento por vez, com respiros; qualidade de edição profissional, nada de selos genéricos.',
    '- Dizer que o fundo é transparente (o vídeo da pessoa fica por baixo) e que a duração total é a do vídeo.',
    '- Ter entre 150 e 400 palavras. Sem pedir áudio, botões/controles, arquivos externos ou ferramentas fora do navegador.',
  ].filter((l) => l !== '').join('\n');
}

/** Analisa o vídeo (fala + quadros) e devolve o prompt da animação que vai por cima dele. */
export async function escreverPromptDoVideo({ modelo, sinal, pastaImagens, ...entrada }) {
  const r = await perguntarClaude({ sistema: SISTEMA, pedido: montarPedidoDoVideo(entrada), modelo, sinal, timeoutMs: 6 * 60_000, pastaImagens });
  return limpar(r.texto);
}

/** Sugere instruções extras (curtas) para o campo "Instruções extras". */
export async function sugerirExtras({ prompt, ideiaExtra, ajustes, modelo, sinal }) {
  const pedido = [
    'Sugira INSTRUÇÕES EXTRAS para melhorar o vídeo abaixo como peça para redes sociais / anúncio.',
    '',
    'PROMPT DO VÍDEO:',
    (prompt || '').trim() || '(vazio)',
    '',
    contexto(ajustes),
    ideiaExtra?.trim() ? `\nO usuário quer nas instruções extras: ${ideiaExtra.trim()}` : '',
    '',
    'Pense em: gancho dos 2 primeiros segundos, legibilidade no celular, áreas seguras do Reels/TikTok',
    '(nada importante nos 15% de cima e 20% de baixo em 9:16), chamada para ação no final, logo/marca,',
    'ritmo dos cortes, contraste, e o que falta no prompt para o vídeo vender mais.',
    'Responda com 4 a 7 instruções curtas e concretas em português, uma por linha, começando com "- ",',
    'cada uma com no máximo 25 palavras. NÃO peça som, música, áudio nem botões/controles na tela',
    '(o som é feito depois, na aba Som do estúdio, e o vídeo é gravado sem interação).',
  ].filter((l) => l !== '').join('\n');
  const r = await perguntarClaude({ sistema: SISTEMA, pedido, modelo, sinal, timeoutMs: 5 * 60_000 });
  return limpar(r.texto);
}

function limpar(t) {
  return String(t || '').replace(/^```[a-z]*\s*|```\s*$/gi, '').trim();
}
