// Edição IA: estilos de edição prontos. Cada estilo fixa o sistema visual (tipografia, cores, posições, ritmo)
// que o plano e cada elemento seguem, a legenda e a cor do vídeo. Puro.

const CRIADOR_TECH = {
  id: 'criador-tech',
  nome: 'Criador tech · roxo cinematográfico',
  descricao: 'Títulos grandes acima da cabeça em dois níveis, cards de vidro escuro com borda roxa, telas de interface com o seu vídeo dentro, legenda discreta em minúsculas e clima escuro com roxo.',
  estilo: { paleta: ['#0b0814', '#8b5cf6', '#c4b5fd', '#ffffff'], fonte: 'Anton', clima: 'cinematográfico escuro com roxo neon, sofisticado e limpo' },
  legendas: { estilo: 'minimal', tam: 'p', pos: 'livre', y: 66, maiusculas: false, porLegenda: 4, fonte: 'moderna' },
  filtro: 'roxo',
  segundosPorElemento: 4.5,
  regrasPlano: `ESTILO "CRIADOR TECH · ROXO CINEMATOGRÁFICO" (siga à risca):
- CONTENÇÃO É O QUE DEIXA PROFISSIONAL. No máximo um elemento a cada ~4,5 s, só nas frases mais fortes. Entre eles, deixe
  trechos de RESPIRO só com a pessoa e a legenda. Nada de selos, emojis, setas genéricas ou "badges" de YouTube.
- TÍTULOS EM DOIS NÍVEIS acima da cabeça (região x 6–94 %, y 6–30 %): uma linha pequena de contexto (ex.: "AQUELE VÍDEO COM",
  "E PENSOU:", "NO SEU VÍDEO") + embaixo 1 a 3 palavras-chave ENORMES tiradas da fala (ex.: "EDIÇÃO INCRÍVEL", "QUERO UM
  DESSE JEITO", "PRA DIRIGIR SUA EDIÇÃO"). O título cresce conforme as palavras são ditas (uma linha nova entra na palavra).
- CARDS FLUTUANTES ao lado da cabeça (região à esquerda x 4–40 % ou à direita x 60–96 %, y 12–45 %): card de vidro escuro com
  borda roxa e leve inclinação, mostrando um exemplo concreto do que está sendo dito (um app, um número, uma tela, um passo).
- TELA DE INTERFACE: quando a pessoa fala do processo/ferramenta, use UM momento de 4–7 s com camada "tela-cheia" desenhando
  uma interface 3D de vidro (editor, painel, app) + um movimento "janela" cuja "regiao" é o retângulo onde o vídeo da pessoa
  aparece dentro da interface (proporção 9:16, ex.: { "x": 8, "y": 14, "w": 44, "h": 44 }). A descrição do elemento deve citar
  esse mesmo retângulo.
- Se a pessoa estiver muito perto da câmera (rosto ocupando o topo), use um movimento "meia" ou "janela" para abrir espaço
  para o título, em vez de cobrir o rosto.
- Movimentos sutis: zoom 1,08–1,15 nas ênfases. Nada de zoom em todo trecho.
- Últimos 2–3 s: cartela final em tela cheia com a chamada da pessoa (o que ela pede no fim da fala).`,
  regrasElemento: `SISTEMA VISUAL "CRIADOR TECH · ROXO CINEMATOGRÁFICO" (obrigatório):
- Tipografia: título em "Anton" (Google Fonts), CAIXA ALTA, enorme (o título deve ocupar a largura do palco), entrelinha 0.9;
  linha de contexto em "JetBrains Mono" 500, caixa alta, pequena, letter-spacing 0.35em, branca a 75 %.
  A última linha do título usa degradê do branco para #c4b5fd/#8b5cf6 e um brilho roxo suave (text-shadow 0 0 40px rgba(139,92,246,.45)).
- Cores: fundo #0b0814, roxo #8b5cf6, lilás #c4b5fd, branco. Nada de azul, amarelo, emojis ou contornos grossos.
- Cards e interfaces: vidro escuro (rgba(18,12,32,.72) + backdrop blur), borda 1.5px rgba(167,139,250,.55), cantos 28px,
  sombra profunda, leve inclinação 3D (rotateY/rotateX até 8°), texto pequeno em Inter/JetBrains Mono, detalhes em roxo.
- Movimento elegante: entra com desfoque + subida curta (blur 12px→0, y +24px→0, 0,45 s, ease out), palavras em sequência
  no tempo da fala; sai com fade + leve desfoque. Nada de quicar, tremer ou girar rápido.
- Limpo e premium: muito espaço vazio, poucos elementos por vez, alinhamento preciso.`,
};

const LIVRE = {
  id: 'livre',
  nome: 'Livre (a IA escolhe o estilo)',
  descricao: 'Sem regras de estilo: a IA cria o visual que achar melhor para o assunto do vídeo.',
  estilo: null,
  legendas: null,
  filtro: '',
  segundosPorElemento: 0,
  regrasPlano: '',
  regrasElemento: '',
};

const comLimite = (e) => ({ ...e, maxElementos: (duracao) => (e.segundosPorElemento ? Math.max(1, Math.ceil(duracao / e.segundosPorElemento)) : 25) });

export const ESTILOS_EDICAO = { [CRIADOR_TECH.id]: comLimite(CRIADOR_TECH), [LIVRE.id]: comLimite(LIVRE) };
export const ESTILO_PADRAO = CRIADOR_TECH.id;

export const estiloPorId = (id) => ESTILOS_EDICAO[id] || ESTILOS_EDICAO[ESTILO_PADRAO];
