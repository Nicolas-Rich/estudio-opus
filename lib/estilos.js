// Estilos visuais para "Criar do zero": cada um vira uma diretriz técnica no pedido ao Claude/Codex.
export const ESTILOS = [
  {
    id: '3d', nome: '3D realista', emoji: '🧊', exemplo: 'produto girando em pedestal, câmera voando',
    diretriz: 'Cena 3D com Three.js (r150+ via CDN): materiais PBR (MeshStandard/MeshPhysical), iluminação de estúdio (key + rim + ambiente HDR gerado em código com RoomEnvironment/PMREM), sombras suaves, reflexo no chão, câmera com movimento cinematográfico (dolly/orbit lento com easing), profundidade de campo sugerida. Produto/objetos modelados com geometrias (cilindros com bevel, LatheGeometry, extrusões) com proporções críveis.',
  },
  {
    id: 'clay', nome: 'Clay / massinha 3D', emoji: '🟠', exemplo: 'formas de massinha, cores pastel',
    diretriz: 'Estilo CLAY 3D (massinha): Three.js com formas super arredondadas (RoundedBox, esferas, cápsulas, tubos grossos), material fosco sem brilho especular (MeshStandardMaterial roughness 0.9–1, metalness 0) com leve ruído de superfície (normal/bump procedural sutil ou vertex displacement de baixa frequência para parecer modelado à mão), cores pastel saturadas, luz suave grande (hemisphere + directional com sombras macias PCFSoft), fundo liso colorido com contact shadow. Movimento "squash & stretch" fofo, bounce com overshoot (back.out/elastic.out). Personagens/objetos simples e simpáticos.',
  },
  {
    id: 'feltro', nome: 'Feltro / brinquedo', emoji: '🧸', exemplo: 'textura de tecido, costuras, miniatura',
    diretriz: 'Estilo FELTRO/BRINQUEDO artesanal: superfícies com textura de tecido gerada em canvas (ruído fibroso), bordas com costura tracejada (stroke dashed), cores quentes e acolhedoras, formas recortadas com espessura e sombra projetada suave (camadas), leve tremor de stop-motion (posição/rotação mudando em passos a ~12 fps, determinístico). Visual de miniatura feita à mão.',
  },
  {
    id: 'voxel', nome: 'Voxel (cubinhos)', emoji: '🟩', exemplo: 'cidade montada bloco a bloco',
    diretriz: 'Estilo VOXEL: tudo construído com cubos (Three.js InstancedMesh), paleta limitada e vibrante, luz direcional com sombras nítidas + ambient occlusion fake (cubos de base mais escuros), câmera isométrica/ortográfica girando devagar. Cenas se montam bloco a bloco com stagger.',
  },
  {
    id: 'pixel', nome: 'Pixel art / retrô', emoji: '👾', exemplo: 'visual de videogame 16-bit',
    diretriz: 'Estilo PIXEL ART 16-bit: desenhe num canvas de baixa resolução (ex.: 1/6 da tela) e amplie com imageSmoothingEnabled=false; paleta limitada (16–32 cores), sprites desenhados em código, animação em passos (sem easing suave), fonte pixelada (Press Start 2P / VT323 do Google Fonts), efeitos de game (piscar, moedas, barras de vida, scanlines sutis).',
  },
  {
    id: 'tipografia', nome: 'Tipografia cinética', emoji: '🔤', exemplo: 'palavras grandes no ritmo, estilo Reels',
    diretriz: 'TIPOGRAFIA CINÉTICA: o texto é o protagonista. Fontes display fortes (Google Fonts: Anton, Bebas Neue, Archivo Black, Inter Tight 900), palavras-chave enormes ocupando a tela, uma ideia por batida, cortes secos e transições rápidas (mask reveal, split por letra/palavra, slide com motion blur simulado, scale punch), contraste alto, uma cor de destaque. Ritmo de Reels: troca de frase a cada 0,6–1,2 s.',
  },
  {
    id: 'motion-marca', nome: 'Motion graphics de marca', emoji: '✨', exemplo: 'revelação de logo, vinheta',
    diretriz: 'MOTION GRAPHICS DE MARCA: formas geométricas limpas (círculos, linhas, retângulos) que se desenham e se transformam (SVG stroke-dashoffset, morph de formas), revelação do logo/nome com máscara, partículas discretas, paleta da marca, easing premium (expo/power4), timing preciso, final com lockup centralizado e respiro.',
  },
  {
    id: 'vidro', nome: 'Glassmorphism / vidro', emoji: '🪟', exemplo: 'cards de vidro fosco flutuando',
    diretriz: 'GLASSMORPHISM: cartões de vidro fosco (backdrop-filter: blur + saturate, borda 1px branca translúcida, brilho especular em gradiente), flutuando em camadas com parallax sobre fundo de gradientes vivos animados (blobs desfocados), sombras suaves, ícones e números nítidos. Movimento lento e elegante.',
  },
  {
    id: 'neon', nome: 'Neon / cyberpunk', emoji: '🌃', exemplo: 'luz neon, grid synthwave',
    diretriz: 'NEON / CYBERPUNK: fundo escuro, linhas e textos com glow forte (text-shadow/filter blur em camadas ou bloom no canvas), magenta + ciano + roxo, grid em perspectiva estilo synthwave, flicker sutil e determinístico, scanlines, glitch RGB em momentos de impacto.',
  },
  {
    id: 'papel', nome: 'Papel recortado', emoji: '📄', exemplo: 'camadas de papel com sombra',
    diretriz: 'PAPEL RECORTADO (paper cut): camadas planas de "papel" com textura granulada sutil, bordas levemente irregulares, sombras projetadas entre camadas para dar profundidade, cores de cartolina, elementos que deslizam/dobram como peças de papel (rotateX/rotateY leves), parallax entre camadas.',
  },
  {
    id: 'mao', nome: 'Desenho à mão / tinta', emoji: '✍️', exemplo: 'traço de caneta se desenhando',
    diretriz: 'DESENHO À MÃO: ilustrações em traço de tinta/caneta que se desenham (SVG stroke-dashoffset com paths levemente irregulares, rough.js via CDN se quiser), textura de papel no fundo, cores de aquarela com manchas suaves (gradientes radiais com bordas irregulares), letras manuscritas (Google Fonts: Caveat, Permanent Marker), leve tremor de linha.',
  },
  {
    id: 'particulas', nome: 'Partículas e fluidos', emoji: '💫', exemplo: 'pó, fumaça, explosão de partículas',
    diretriz: 'PARTÍCULAS E FLUIDOS: sistemas de milhares de partículas (canvas 2D ou WebGL/Three.js Points) com física simples determinística (PRNG com semente), campos de fluxo (curl noise), pó/fumaça/faíscas, explosões que formam e desfazem textos/logos, brilho aditivo (blending additive), motion trails.',
  },
  {
    id: 'premium', nome: 'Cromado / mármore premium', emoji: '💎', exemplo: 'letras cromadas, mármore preto',
    diretriz: 'PREMIUM / LUXO: materiais nobres — cromado e metal escovado (Three.js metalness 1 com environment map), mármore (textura procedural em shader/canvas), dourado, preto profundo; reflexos que varrem as superfícies (light sweep), câmera lenta, tipografia serifada elegante ou sans fina com bastante espaço, poucas cores.',
  },
  {
    id: 'dados', nome: 'Infográfico / dados', emoji: '📊', exemplo: 'números contando, gráficos, mapas',
    diretriz: 'INFOGRÁFICO / DADOS: gráficos animados (barras crescendo, linhas se desenhando, pizza/donut), números contando até o valor final, ícones simples, mapas/globo se for o caso, hierarquia visual clara, grid organizado, legendas legíveis, uma cor de destaque para o dado principal.',
  },
  {
    id: 'interface', nome: 'Interface / app', emoji: '📱', exemplo: 'celular mostrando o app, cursor clicando',
    diretriz: 'INTERFACE / DEMONSTRAÇÃO DE APP: mockup de celular ou navegador recriado em HTML/CSS (cantos, notch, barra de status), telas de app fictícias porém realistas, cursor/dedo que se move e clica (ripple), rolagem suave, zoom de câmera no detalhe importante, notificações aparecendo.',
  },
  {
    id: 'generativo', nome: 'Arte generativa / shader', emoji: '🌀', exemplo: 'fundo abstrato fluido, hipnótico',
    diretriz: 'ARTE GENERATIVA / SHADER: fragment shader em WebGL (fullscreen quad) com noise (simplex/fbm), domain warping, gradientes vivos que fluem, padrões hipnóticos; texto por cima com bom contraste. Tudo dirigido pelo tempo, determinístico.',
  },
  {
    id: 'terminal', nome: 'Terminal / hacker', emoji: '💻', exemplo: 'texto digitando, glitch',
    diretriz: 'TERMINAL / HACKER: tela de terminal (fundo escuro, fonte mono JetBrains Mono/Fira Code), texto sendo digitado com cursor piscando, linhas de log, barras de progresso em ASCII, efeitos de glitch e chromatic aberration nos momentos de impacto, verde/âmbar ou a cor da marca.',
  },
];

export const estiloPorId = (id) => ESTILOS.find((e) => e.id === id) || null;

/** Linha que entra no pedido ao Claude. */
export const blocoEstilo = (id) => {
  const e = estiloPorId(id);
  return e
    ? `- ESTILO VISUAL OBRIGATÓRIO — ${e.nome.toUpperCase()}: ${e.diretriz}`
      + ' Em qualquer estilo: TODOS os textos pedidos aparecem grandes e legíveis (em cena 3D/canvas, use texto HTML por cima, com fonte combinando com o estilo),'
      + ' e a composição usa o quadro inteiro no formato pedido (no vertical, distribua de cima a baixo; nada de metade da tela vazia).'
    : '';
};
