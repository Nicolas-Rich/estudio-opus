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
