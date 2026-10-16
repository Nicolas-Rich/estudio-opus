// Confere o JavaScript da animação antes de salvar: um erro de sintaxe deixa o vídeo inteiro em tela preta.
import vm from 'node:vm';

// -(a/b)**2 é proibido no JS (sinal antes de potência); o certo é -((a/b)**2).
// Cobre o caso comum das curvas gaussianas: Math.exp(-((t-x)/s)**2)
const SINAL_ANTES_DE_POTENCIA = /([-+])(\((?:[^()]|\([^()]*\))*\))\*\*(\d+(?:\.\d+)?|\w+)/g;

const scriptsInline = (html) => [...html.matchAll(/<script(?![^>]*\b(?:src|type\s*=\s*["']?(?:module|importmap|application\/json|text\/plain)))[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

function errosDeSintaxe(html) {
  const erros = [];
  for (const s of scriptsInline(html)) {
    try { new vm.Script(s); } catch (e) { if (e instanceof SyntaxError) erros.push(e.message); }
  }
  return erros;
}

/** Corrige o que dá para corrigir sozinho e devolve os erros de sintaxe que sobraram. */
export function consertarHtml(html) {
  if (!errosDeSintaxe(html).length) return { html, trocas: 0, erros: [] };
  let trocas = 0;
  const novo = html.replace(SINAL_ANTES_DE_POTENCIA, (m, sinal, base, exp, pos, tudo) => {
    // só quando o sinal é unário (vem depois de um operador, parêntese, vírgula ou início)
    const antes = tudo.slice(0, pos).trimEnd().slice(-1);
    if (antes && !/[=(,:?&|!+\-*/%<>[{;]/.test(antes)) return m;
    trocas++;
    return `${sinal}(${base}**${exp})`;
  });
  return { html: novo, trocas, erros: errosDeSintaxe(novo) };
}
