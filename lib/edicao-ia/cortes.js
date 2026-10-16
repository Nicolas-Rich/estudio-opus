// Edição IA: trechos que podem ser cortados (silêncios e vícios de fala). Puro: sem disco nem rede.
// O Claude decide os cortes finais no plano; isto só aponta os candidatos.

const RESPIRO = 0.12; // segundos mantidos de cada lado de um silêncio cortado
const MIN_SILENCIO = 0.4;
const VICIOS = new Set(['é', 'éé', 'hã', 'hum', 'tipo', 'né']);
const PAUSA_ISOLADO = 0.15;
const PAUSA_ENTAO = 0.3;

const r2 = (x) => Math.round(x * 100) / 100;
const normalizar = (p) => String(p).toLowerCase().replace(/[^\p{L}]+/gu, '');

function silenciosCortaveis(silencios, palavras) {
  const out = [];
  for (const s of silencios) {
    let a = s.inicio + RESPIRO;
    let b = s.fim - RESPIRO;
    // nunca corta dentro de uma palavra: encolhe até a borda dela
    for (const w of palavras) {
      if (w.inicio >= b || w.fim <= a) continue;
      if (w.inicio > a) b = Math.min(b, w.inicio);
      else a = Math.max(a, w.fim);
    }
    if (b - a >= MIN_SILENCIO) out.push({ inicio: r2(a), fim: r2(b), motivo: 'silencio' });
  }
  return out;
}

function viciosIsolados(palavras) {
  const out = [];
  palavras.forEach((w, i) => {
    const n = normalizar(w.p);
    const antes = i > 0 ? w.inicio - palavras[i - 1].fim : Infinity;
    const depois = i < palavras.length - 1 ? palavras[i + 1].inicio - w.fim : Infinity;
    // "é" também é verbo: só conta como vício com pausa em volta ou com marca de hesitação ("é…")
    const hesitacao = /…|\.\.\./.test(w.p);
    const ehVicio = n === 'então' ? depois >= PAUSA_ENTAO
      : VICIOS.has(n) && (hesitacao || antes >= PAUSA_ISOLADO || depois >= PAUSA_ISOLADO);
    if (ehVicio) out.push({ inicio: r2(w.inicio), fim: r2(w.fim), motivo: 'vicio' });
  });
  return out;
}

/** Candidatos a corte, ordenados e sem sobreposição: [{ inicio, fim, motivo: 'silencio'|'vicio' }]. */
export function candidatosDeCorte({ palavras = [], silencios = [], duracao = Infinity }) {
  const todos = [...silenciosCortaveis(silencios, palavras), ...viciosIsolados(palavras)]
    .map((c) => ({ ...c, inicio: Math.max(0, c.inicio), fim: Math.min(duracao, c.fim) }))
    .filter((c) => c.fim > c.inicio)
    .sort((a, b) => a.inicio - b.inicio);
  const unidos = [];
  for (const c of todos) {
    const ult = unidos.at(-1);
    if (ult && c.inicio <= ult.fim) {
      ult.fim = Math.max(ult.fim, c.fim);
      if (c.motivo === 'silencio') ult.motivo = 'silencio';
    } else unidos.push({ ...c });
  }
  return unidos;
}
