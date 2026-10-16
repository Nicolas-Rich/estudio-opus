// Edição IA: cada elemento do plano vira uma animação HTML (Claude) renderizada com transparência.
import fs from 'node:fs/promises';
import path from 'node:path';
import { gerarComClaude } from '../claude.js';
import { consertarHtml } from '../checar-html.js';
import { renderizarHtml } from '../render.js';

const W = 1080;
const H = 1920;

/** Tamanho do palco do elemento em pixels. */
export function palcoDoElemento(el) {
  if (el.camada !== 'sobre' || !el.regiao) return { largura: W, altura: H };
  return { largura: Math.max(2, Math.round((el.regiao.w / 100) * W)), altura: Math.max(2, Math.round((el.regiao.h / 100) * H)) };
}

/** O erro é o limite de uso do Claude (a fila deve pausar)? */
// só o aviso de limite de USO do Claude (não "limite de tokens" de uma resposta cortada)
export const ehLimiteClaude = (erro) => /usage limit|hit your (?:\w+ )?limit|weekly limit|limit reached|limit · resets|resets? (?:at|in|on) /i.test(String(erro?.message || erro || ''));

/** Pedido ao Claude para um elemento. */
export function montarPedidoElemento({ el, estilo = {}, palavras = [], instrucao = '', furo = null }) {
  const { largura, altura } = palcoDoElemento(el);
  const dur = el.fim - el.inicio;
  const fala = palavras.filter((w) => w.inicio >= el.inicio && w.inicio < el.fim)
    .map((w) => `${(w.inicio - el.inicio).toFixed(2)} ${w.p}`).join(' · ');
  const fundo = el.camada === 'sobre'
    ? '- Fundo TRANSPARENTE: html, body { background: transparent } e nenhum retângulo de fundo cobrindo o palco. Só o elemento aparece; o vídeo da pessoa fica visível por trás (transparent).'
    : '- Tela cheia: desenhe um fundo próprio que cubra todo o palco, no estilo do vídeo.';
  const meio = furo?.filter((q) => q.w > 0)[Math.floor(furo.filter((q) => q.w > 0).length / 2)];
  const aviso = meio
    ? `- A pessoa aparece encolhida por cima do seu elemento no retângulo x ${meio.x}, y ${meio.y}, ${meio.w}×${meio.h} px (o estúdio deixa essa área transparente sozinho). Não coloque nada importante ali; componha em volta dela.`
    : '';
  return [
    'ELEMENTO ANIMADO PARA UMA EDIÇÃO DE VÍDEO VERTICAL (vai por cima do vídeo de uma pessoa falando para a câmera).',
    `O que criar: ${el.descricao || ''}`,
    el.textoNaTela ? `Texto na tela: "${el.textoNaTela}"` : '',
    instrucao ? `PEDIDO DA PESSOA PARA ESTA VERSÃO: ${instrucao}` : '',
    `Duração: ${dur.toFixed(2)} s exatos. Palco: ${largura}×${altura} px.`,
    `Estilo do vídeo inteiro: paleta ${(estilo.paleta || []).join(', ')}; fonte ${estilo.fonte || 'Inter'} (Google Fonts); clima: ${estilo.clima || 'livre'}.`,
    fala ? `Fala da pessoa neste trecho (segundos desde o início do elemento): ${fala}\nSincronize as entradas e os destaques com essas palavras (±0,15 s).` : '',
    '',
    'Regras técnicas:',
    fundo,
    aviso,
    '- Começa sozinho e é dirigido por tempo; entra animado logo no início e sai animado antes do fim da duração.',
    '- Liberdade criativa total: 3D (three.js), partículas, tipografia cinética, ícones, gráficos — o que deixar o vídeo mais atraente.',
    '- Texto grande e legível no celular.',
  ].filter(Boolean).join('\n');
}

async function proximaVersao(dir) {
  const ns = (await fs.readdir(dir).catch(() => [])).map((f) => /^v(\d+)\.html$/.exec(f)?.[1]).filter(Boolean).map(Number);
  return (ns.length ? Math.max(...ns) : 0) + 1;
}

/**
 * Gera o HTML do elemento (com conserto e, se preciso, uma correção pelo Claude) e renderiza
 * render.mov (exportação) + preview.webm (prévia). urlDe(n) é a URL que serve o v<n>.html.
 */
export async function gerarElemento({ el, estilo, palavras, pasta, urlDe, modelo, sinal, aoProgresso, instrucao, furo = null }) {
  const dir = path.join(pasta, 'elementos', el.id);
  await fs.mkdir(dir, { recursive: true });
  const pedido = montarPedidoElemento({ el, estilo, palavras, instrucao, furo });
  const r = await gerarComClaude({ pedido, modelo, aoProgresso, sinal });
  let custo = r.custo || 0;
  let conferido = consertarHtml(r.html);
  if (conferido.erros.length) {
    aoProgresso?.(0, 'Corrigindo um erro de código…');
    const r2 = await gerarComClaude({
      pedido: `${pedido}\n\nA versão abaixo tem este erro de JavaScript: ${conferido.erros[0]}\nDevolva o documento inteiro corrigido.\n\n${conferido.html}`,
      modelo, aoProgresso, sinal,
    });
    custo += r2.custo || 0;
    conferido = consertarHtml(r2.html);
    if (conferido.erros.length) throw new Error(`O código do elemento ${el.id} continua com erro: ${conferido.erros[0]}`);
  }
  const versao = await proximaVersao(dir);
  await fs.writeFile(path.join(dir, `v${versao}.html`), conferido.html, 'utf8');
  await renderizarElemento({ el, pasta, url: urlDe(versao), furo, sinal, aoProgresso });
  return { versao, custo };
}

/** Renderiza em arquivos temporários e só troca render.mov/preview.webm quando os dois deram certo. */
export async function renderizarElemento({ el, pasta, url, furo = null, sinal, aoProgresso, render = renderizarHtml }) {
  const dir = path.join(pasta, 'elementos', el.id);
  const tmpMov = path.join(dir, 'render.tmp.mov');
  const tmpWebm = path.join(dir, 'preview.tmp.webm');
  const { largura, altura } = palcoDoElemento(el);
  try {
    await render({
      url, largura, altura, fps: 30, duracao: el.fim - el.inicio, saida: tmpMov, saidaPreview: tmpWebm, transparente: true, furo,
      sinal, progresso: (p, m) => aoProgresso?.(0, m || (p != null ? `Renderizando ${Math.round(p * 100)}%` : '')),
    });
    await fs.rename(tmpMov, path.join(dir, 'render.mov'));
    await fs.rename(tmpWebm, path.join(dir, 'preview.webm'));
  } finally {
    await Promise.all([fs.rm(tmpMov, { force: true }), fs.rm(tmpWebm, { force: true })]);
  }
}
