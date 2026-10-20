// Guia de qualidade HyperFrames (github.com/heygen-com/hyperframes, Apache-2.0, da HeyGen).
// Baixamos só as "skills" de criação (blueprints de cena, receitas de movimento, paletas, princípios de
// motion design) e deixamos o Claude/Codex consultá-las com a ferramenta Read durante a geração.
// O formato do vídeo continua o do estúdio (HTML que toca sozinho + relógio virtual no render).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const URL_HF = 'https://github.com/heygen-com/hyperframes.git';
const PARTES = ['skills/hyperframes-animation', 'skills/hyperframes-creative', 'skills/motion-graphics', 'LICENSE'];
export const NOME_GUIA = 'guia-hyperframes';

function git(args, cwd) {
  return new Promise((ok, falha) => {
    const p = spawn('git', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok() : falha(new Error(`git ${args[0]}: ${err.slice(-300)}`))));
  });
}

let pasta = null;
let pronto = false;
let baixando = null;

/** Baixa (uma vez) só as pastas de skills necessárias, com sparse-checkout. Não bloqueia o servidor. */
export function garantirGuia(raiz) {
  pasta = path.join(raiz, 'hyperframes-guia');
  if (existsSync(path.join(pasta, 'skills', 'hyperframes-animation', 'SKILL.md'))) {
    pronto = true;
    return Promise.resolve(true);
  }
  if (baixando) return baixando;
  baixando = (async () => {
    try {
      await fs.rm(pasta, { recursive: true, force: true });
      console.log('  Baixando o guia de qualidade HyperFrames (só as skills, uma vez)…');
      await git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', URL_HF, pasta], raiz);
      await git(['sparse-checkout', 'set', '--no-cone', ...PARTES.map((p) => '/' + p + (p.includes('.') || p === 'LICENSE' ? '' : '/'))], pasta);
      pronto = existsSync(path.join(pasta, 'skills', 'hyperframes-animation', 'SKILL.md'));
      console.log(pronto ? '  Guia HyperFrames pronto.' : '  Guia HyperFrames incompleto (a geração segue sem ele).');
    } catch (e) {
      console.warn('  Não consegui baixar o guia HyperFrames (a geração segue sem ele):', e.message);
      pronto = false;
    } finally {
      baixando = null;
    }
    return pronto;
  })();
  return baixando;
}

export const guiaPronto = () => pronto;

/** Atualiza o guia (git pull). */
export async function atualizarGuia() {
  if (!pronto) return garantirGuia(path.dirname(pasta));
  await git(['pull', '--depth', '1', '--ff-only'], pasta).catch(() => {});
  return true;
}

/**
 * Pasta de trabalho da geração: cópia das imagens do usuário + atalho (junction) para o guia.
 * O Claude roda com cwd nela e só pode ler o que está dentro.
 */
export async function prepararPastaTrabalho(pastaProjeto, pastaAssets, nomesImagens = []) {
  const dir = path.join(pastaProjeto, 'trabalho');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const n of nomesImagens) {
    const orig = path.join(pastaAssets, n);
    if (existsSync(orig)) await fs.copyFile(orig, path.join(dir, n));
  }
  if (pronto) await fs.symlink(path.join(pasta, 'skills'), path.join(dir, NOME_GUIA), 'junction').catch(() => {});
  return dir;
}

/** Instruções para o modelo usar o guia (vão no fim do pedido). */
export const BLOCO_GUIA = [
  '',
  `GUIA DE QUALIDADE (HyperFrames, da HeyGen) — está na pasta "${NOME_GUIA}/" e você pode abrir os arquivos com a ferramenta Read.`,
  'ANTES de escrever o código, consulte (leitura rápida, só o que servir para ESTE vídeo):',
  `1. ${NOME_GUIA}/hyperframes-animation/blueprints-index.md → escolha o blueprint (cena testada em vídeos reais) que combina com cada momento do vídeo e abra ${NOME_GUIA}/hyperframes-animation/blueprints/<id>.md dos escolhidos (1 a 3).`,
  `2. ${NOME_GUIA}/hyperframes-animation/rules-index.md → escolha 2 a 4 receitas de movimento e abra ${NOME_GUIA}/hyperframes-animation/rules/<nome>.md.`,
  `3. ${NOME_GUIA}/hyperframes-creative/references/motion-principles.md (princípios de movimento) e, se o usuário não definiu cores, uma paleta em ${NOME_GUIA}/hyperframes-creative/palettes/.`,
  `4. Para GSAP: ${NOME_GUIA}/hyperframes-animation/adapters/gsap-easing-and-stagger.md.`,
  'COMO ADAPTAR AO NOSSO FORMATO (importante — não é um projeto HyperFrames):',
  '- Entregue o HTML único de sempre (sem data-composition-id, data-start, class="clip", sub-composições nem CLI).',
  '- Monte UMA timeline GSAP principal, registre em window.__timelines = { main: tl } e chame tl.play() ao final do script (ela precisa tocar sozinha).',
  '- Siga as regras de determinismo do guia: sem Math.random sem semente, sem Date.now; fromTo com estados iniciais explícitos; anime transform/opacity (não width/height/top/left).',
  '- Use o RITMO dos blueprints (conteúdo chegando ao longo do tempo, um "signature move" por cena, nada parado nem tudo de uma vez em t=0).',
  '- Não gaste a resposta resumindo o guia: leia, decida e entregue o HTML.',
].join('\n');
