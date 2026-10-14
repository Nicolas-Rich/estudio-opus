// Prepara o texto para a voz falar certo em português do Brasil:
// números, preços, porcentagens, ordinais e símbolos viram palavras.

const UNI = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze',
  'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n < 20) return UNI[n];
  if (n < 100) return DEZ[Math.floor(n / 10)] + (n % 10 ? ' e ' + UNI[n % 10] : '');
  if (n === 100) return 'cem';
  return CEM[Math.floor(n / 100)] + (n % 100 ? ' e ' + ate999(n % 100) : '');
}

/** 1234567 → "um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete" */
export function numeroPorExtenso(n) {
  n = Math.floor(Math.abs(n));
  if (n < 1000) return ate999(n);
  const partes = [];
  const grupos = [[1e9, 'bilhão', 'bilhões'], [1e6, 'milhão', 'milhões'], [1e3, 'mil', 'mil']];
  let resto = n;
  for (const [v, sing, plur] of grupos) {
    const q = Math.floor(resto / v);
    if (q) {
      partes.push(v === 1e3 && q === 1 ? 'mil' : `${numeroPorExtenso(q)} ${q === 1 ? sing : plur}`);
      resto %= v;
    }
  }
  if (resto) partes.push(ate999(resto));
  // "mil e duzentos", "dois mil e cinco": usa "e" antes da última parte quando ela é < 100 ou centena redonda
  if (partes.length > 1 && (resto < 100 || resto % 100 === 0)) {
    const ult = partes.pop();
    return partes.join(' ') + ' e ' + ult;
  }
  return partes.join(' ');
}

const feminino = (s) => s.replace(/\bum\b$/, 'uma').replace(/\bdois\b$/, 'duas').replace(/zentos\b/g, 'zentas');
const ORD = ['', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo', 'nono', 'décimo'];

function numeroBR(txt) {
  // "1.234,56" ou "1234.56" → número
  const limpo = txt.includes(',') ? txt.replace(/\./g, '').replace(',', '.') : (/^\d{1,3}(\.\d{3})+$/.test(txt) ? txt.replace(/\./g, '') : txt);
  return Number(limpo);
}

function decimalPorExtenso(txt) {
  const n = numeroBR(txt);
  if (!Number.isFinite(n)) return txt;
  const inteiro = Math.floor(n);
  const dec = txt.includes(',') ? txt.split(',')[1] : (txt.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(txt) ? txt.split('.')[1] : '');
  if (!dec || /^0+$/.test(dec)) return numeroPorExtenso(inteiro);
  return `${numeroPorExtenso(inteiro)} vírgula ${dec.length <= 2 ? numeroPorExtenso(+dec) : [...dec].map((d) => UNI[+d]).join(' ')}`;
}

export function normalizarFala(texto) {
  let t = String(texto || '');
  // preços: R$ 97,80 / R$97 / R$ 1.299,90
  t = t.replace(/R\$\s?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/g, (_, r, c) => {
    const reais = numeroBR(r);
    const cent = c ? +c.padEnd(2, '0') : 0;
    let s = `${numeroPorExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`;
    if (cent) s += ` e ${numeroPorExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`;
    return s;
  });
  // porcentagem
  t = t.replace(/(\d+(?:[.,]\d+)?)\s?%/g, (_, n) => `${decimalPorExtenso(n)} por cento`);
  // "+40 aulas" → "mais de quarenta aulas"
  t = t.replace(/(^|[\s(])\+\s?(\d)/g, '$1mais de $2');
  // ordinais 1º 2ª
  t = t.replace(/\b(\d{1,2})\s?([ºª])/g, (_, n, g) => {
    const o = ORD[+n] || `${numeroPorExtenso(+n)}`;
    return g === 'ª' ? o.replace(/o$/, 'a') : o;
  });
  // horas 10h, 10h30
  t = t.replace(/\b(\d{1,2})h(\d{2})?\b/g, (_, h, m) => `${feminino(numeroPorExtenso(+h))} ${+h === 1 ? 'hora' : 'horas'}${m ? ` e ${numeroPorExtenso(+m)}` : ''}`);
  // multiplicador 2x, 10x
  t = t.replace(/\b(\d+)\s?x\b/gi, (_, n) => `${numeroPorExtenso(+n)} vezes`);
  // 4K / 1080p / 9:16 (formatos falados de forma natural)
  t = t.replace(/\b4K\b/g, 'quatro K').replace(/\b(\d{3,4})p\b/g, (_, n) => `${numeroPorExtenso(+n)} p`);
  t = t.replace(/\b(\d+):(\d+)\b/g, (_, a, b) => `${numeroPorExtenso(+a)} por ${numeroPorExtenso(+b)}`);
  // números soltos (com milhar/decimal)
  t = t.replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b|\b\d+(?:,\d+)?\b/g, (n) => decimalPorExtenso(n));
  // símbolos
  t = t.replace(/\s&\s/g, ' e ').replace(/\s\/\s/g, ' ou ').replace(/→|->/g, ', ').replace(/[“”"]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}
