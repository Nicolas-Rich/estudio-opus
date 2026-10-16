// Gera o arquivo .ass (libass) com os textos da faixa "Textos" e as legendas automáticas,
// no estilo dos editores de celular (contorno grosso, palavra ativa destacada, caixa, etc.).

// cor #RRGGBB (+ alfa 0–255, 0 = opaco) → &HAABBGGRR
function corAss(hex = '#ffffff', alfa = 0) {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] || 'ffffff';
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return `&H${alfa.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase();
}
const tempo = (s) => {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${seg}`;
};
const limpar = (t) => String(t || '').replace(/[{}\\]/g, '').replace(/\r?\n/g, '\\N');

const FONTES = { impacto: 'Impact', negrito: 'Arial Black', serifa: 'Georgia', normal: 'Arial', moderna: 'Segoe UI Black' };
const TAM_TEXTO = { p: 0.035, m: 0.05, g: 0.07, gg: 0.095 };
const TAM_LEGENDA = { p: 0.038, m: 0.05, g: 0.064 };

// presets de texto (faixa Textos)
export const ESTILOS_TEXTO = {
  contorno: { nome: 'Branco com contorno', cor: '#ffffff', contorno: '#000000', caixa: false },
  caixa: { nome: 'Caixa preta', cor: '#ffffff', contorno: '#000000', caixa: true },
  amarelo: { nome: 'Amarelo impacto', cor: '#ffd400', contorno: '#000000', caixa: false },
  neon: { nome: 'Neon', cor: '#ffffff', contorno: '#ff2e88', caixa: false, brilho: true },
  vermelho: { nome: 'Faixa vermelha', cor: '#ffffff', contorno: '#e11d2e', caixa: true },
};
// presets de legenda
export const ESTILOS_LEGENDA = {
  capcut: { nome: 'Destaque amarelo (CapCut)', cor: '#ffffff', destaque: '#ffd400', contorno: '#000000', caixa: false, pulo: true },
  verde: { nome: 'Destaque verde', cor: '#ffffff', destaque: '#39ff6a', contorno: '#000000', caixa: false, pulo: true },
  caixa: { nome: 'Caixa preta', cor: '#ffffff', destaque: '#ffd400', contorno: '#000000', caixa: true, pulo: false },
  karaoke: { nome: 'Karaokê (preenche ao falar)', cor: '#ffffff', destaque: '#00e5ff', contorno: '#000000', caixa: false, karaoke: true },
  simples: { nome: 'Simples', cor: '#ffffff', destaque: null, contorno: '#000000', caixa: false },
  minimal: { nome: 'Minimal roxo (discreta)', cor: '#ffffff', destaque: '#a78bfa', contorno: '#000000', caixa: false, pulo: false, suave: true },
};

function posicao(pos, W, H, yPct) {
  // devolve alinhamento \an e \pos
  if (pos === 'topo') return { an: 8, x: W / 2, y: H * 0.12 };
  if (pos === 'centro') return { an: 5, x: W / 2, y: H * 0.5 };
  if (pos === 'livre' && yPct != null) return { an: 5, x: W / 2, y: H * (yPct / 100) };
  return { an: 2, x: W / 2, y: H * 0.80 }; // base, acima da interface do Reels/TikTok
}

export function gerarAss({ largura: W, altura: H, textos = [], legendas = null }) {
  const L = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // BorderStyle 1 = contorno; 3 = caixa opaca
    `Style: Contorno,Arial Black,${Math.round(H * 0.05)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(H * 0.0035))},${Math.round(H * 0.0015)},2,${Math.round(W * 0.06)},${Math.round(W * 0.06)},0,1`,
    `Style: Caixa,Arial Black,${Math.round(H * 0.05)},&H00FFFFFF,&H00FFFFFF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,3,${Math.round(H * 0.008)},0,2,${Math.round(W * 0.06)},${Math.round(W * 0.06)},0,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  // ---------- faixa Textos
  for (const t of textos) {
    if (!t.texto?.trim() || !(t.fim > t.inicio)) continue;
    const est = ESTILOS_TEXTO[t.estilo] || ESTILOS_TEXTO.contorno;
    const fs = Math.round(H * (TAM_TEXTO[t.tam] || 0.05));
    const p = posicao(t.pos, W, H, t.y);
    const cor = t.cor || est.cor;
    let o = `{\\an${p.an}\\pos(${p.x.toFixed(0)},${p.y.toFixed(0)})\\fn${FONTES[t.fonte] || 'Arial Black'}\\fs${fs}\\c${corAss(cor)}`;
    o += est.caixa ? `\\3c${corAss(est.contorno, 0x20)}\\4c${corAss(est.contorno, 0x20)}` : `\\3c${corAss(est.contorno)}\\bord${Math.max(2, Math.round(fs * 0.08))}`;
    if (est.brilho) o += `\\blur${Math.round(fs * 0.12)}`;
    const anim = t.anim || 'fade';
    if (anim === 'fade') o += '\\fad(200,200)';
    if (anim === 'pop') o += '\\fad(80,150)\\fscx30\\fscy30\\t(0,180,\\fscx112\\fscy112)\\t(180,280,\\fscx100\\fscy100)';
    if (anim === 'subir') o += `\\fad(150,150)\\move(${p.x.toFixed(0)},${(p.y + H * 0.04).toFixed(0)},${p.x.toFixed(0)},${p.y.toFixed(0)},0,260)`;
    if (anim === 'digitar') {
      const letras = [...t.texto.trim()];
      const passo = Math.max(2, Math.round(Math.min(60, ((t.fim - t.inicio) * 0.5 * 100) / letras.length)));
      // letras ainda não "digitadas" ficam invisíveis (alfa secundário) e aparecem uma a uma
      o += '\\2a&HFF&\\3a&HFF&}' + letras.map((c) => `{\\k${passo}}${limpar(c)}`).join('');
      L.push(`Dialogue: 2,${tempo(t.inicio)},${tempo(t.fim)},${est.caixa ? 'Caixa' : 'Contorno'},,0,0,0,,${o}`);
      continue;
    }
    L.push(`Dialogue: 2,${tempo(t.inicio)},${tempo(t.fim)},${est.caixa ? 'Caixa' : 'Contorno'},,0,0,0,,${o}}${limpar(t.texto.trim())}`);
  }

  // ---------- legendas automáticas
  if (legendas?.ativo !== false && legendas?.itens?.length) {
    const est = ESTILOS_LEGENDA[legendas.estilo] || ESTILOS_LEGENDA.capcut;
    const fs = Math.round(H * (TAM_LEGENDA[legendas.tam] || 0.05));
    const p = posicao(legendas.pos || 'base', W, H, legendas.y);
    const cor = legendas.cor || est.cor;
    const destaque = legendas.destaque || est.destaque;
    const caixa = est.caixa;
    const base = `{\\an${p.an}\\pos(${p.x.toFixed(0)},${p.y.toFixed(0)})\\fn${FONTES[legendas.fonte] || 'Arial Black'}\\fs${fs}\\c${corAss(cor)}`
      + (caixa ? '' : est.suave
        ? `\\3c${corAss(est.contorno, 0x90)}\\bord${Math.max(1, Math.round(fs * 0.035))}\\4c${corAss('#000000', 0x60)}\\shad${Math.round(fs * 0.06)}`
        : `\\3c${corAss(est.contorno)}\\bord${Math.max(2, Math.round(fs * 0.09))}\\shad${Math.round(fs * 0.04)}`) + '}';
    const caixaAlta = (s) => (legendas.maiusculas === false ? s : s.toLocaleUpperCase('pt-BR'));
    for (const it of legendas.itens) {
      const palavras = (it.palavras?.length ? it.palavras : [{ inicio: it.inicio, fim: it.fim, p: it.texto }])
        .map((w) => ({ ...w, p: limpar(caixaAlta(w.p)) }));
      const ini = it.inicio;
      const fim = Math.max(it.fim, ini + 0.2);
      const estilo = caixa ? 'Caixa' : 'Contorno';
      if (est.karaoke) {
        // preenche palavra a palavra: SecondaryColour (antes) → PrimaryColour (destaque)
        const k = palavras.map((w, i) => {
          const fimW = palavras[i + 1]?.inicio ?? fim;
          return `{\\kf${Math.max(1, Math.round((fimW - w.inicio) * 100))}}${w.p} `;
        }).join('').trim();
        const pre = palavras[0].inicio > ini ? `{\\k${Math.round((palavras[0].inicio - ini) * 100)}}` : '';
        L.push(`Dialogue: 1,${tempo(ini)},${tempo(fim)},${estilo},,0,0,0,,${base.replace(`\\c${corAss(cor)}`, `\\c${corAss(destaque)}\\2c${corAss(cor)}`)}${pre}${k}`);
      } else if (destaque && palavras.length > 1) {
        // um evento por palavra ativa (só ela colorida/maior), como nos apps
        palavras.forEach((w, i) => {
          const a = i === 0 ? ini : w.inicio;
          const b = palavras[i + 1]?.inicio ?? fim;
          if (b <= a) return;
          const linha = palavras.map((x, j) => (j === i
            ? `{\\c${corAss(destaque)}${est.pulo ? '\\fscx112\\fscy112' : ''}}${x.p}{\\c${corAss(cor)}\\fscx100\\fscy100}`
            : x.p)).join(' ');
          L.push(`Dialogue: 1,${tempo(a)},${tempo(b)},${estilo},,0,0,0,,${base}${linha}`);
        });
      } else {
        L.push(`Dialogue: 1,${tempo(ini)},${tempo(fim)},${estilo},,0,0,0,,${base}${palavras.map((w) => w.p).join(' ')}`);
      }
    }
  }
  return L.join('\n') + '\n';
}

/** Agrupa palavras (com tempo) em legendas de até N palavras, quebrando também em pontuação e pausas. */
export function agruparLegendas(palavras, porLegenda = 3) {
  const itens = [];
  let atual = [];
  const fechar = () => {
    if (!atual.length) return;
    itens.push({ inicio: atual[0].inicio, fim: atual.at(-1).fim, texto: atual.map((w) => w.p).join(' '), palavras: atual });
    atual = [];
  };
  for (const w of palavras) {
    const ant = atual.at(-1);
    if (ant && (w.inicio - ant.fim > 0.45 || atual.length >= porLegenda)) fechar();
    atual.push(w);
    if (/[.!?;:]$/.test(w.p)) fechar();
  }
  fechar();
  return itens;
}
