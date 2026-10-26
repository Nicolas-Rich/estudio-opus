// Guia de qualidade HyperFrames (github.com/heygen-com/hyperframes, Apache-2.0, da HeyGen).
// Baixamos só a skill "hyperframes" (referências de movimento, história, visual e tipos de vídeo, mais os
// presets visuais) e deixamos o Claude/Codex consultá-la com a ferramenta Read durante a geração.
// O formato do vídeo continua o do estúdio (HTML que toca sozinho + relógio virtual no render).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const URL_HF = 'https://github.com/heygen-com/hyperframes.git';
const SKILL = 'skills/hyperframes';
// sparse-checkout sem cone: só os .md (os presets trazem fontes e HTML de demonstração que a IA não usa)
const PARTES = [`/${SKILL}/SKILL.md`, `/${SKILL}/references/`, `/${SKILL}/assets/frame-presets/*/FRAME.md`, '/LICENSE'];
// se este arquivo existe, o guia está no formato que o BLOCO_GUIA espera (instalações antigas são baixadas de novo)
const MARCA = path.join(...SKILL.split('/'), 'references', 'motion.md');
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
  if (existsSync(path.join(pasta, MARCA))) {
    pronto = true;
    return Promise.resolve(true);
  }
  if (baixando) return baixando;
  baixando = (async () => {
    try {
      await fs.rm(pasta, { recursive: true, force: true });
      console.log('  Baixando o guia de qualidade HyperFrames (só as skills, uma vez)…');
      await git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', URL_HF, pasta], raiz);
      await git(['sparse-checkout', 'set', '--no-cone', ...PARTES], pasta);
      pronto = existsSync(path.join(pasta, MARCA));
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
  // se o repositório mudou de estrutura de novo, baixa do zero em vez de apontar a IA para arquivos que sumiram
  if (!existsSync(path.join(pasta, MARCA))) {
    pronto = false;
    return garantirGuia(path.dirname(pasta));
  }
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
  if (pronto) await fs.symlink(path.join(pasta, ...SKILL.split('/')), path.join(dir, NOME_GUIA), 'junction').catch(() => {});
  return dir;
}

/** Instruções para o modelo usar o guia (vão no fim do pedido). */
export const BLOCO_GUIA = [
  '',
  `GUIA DE QUALIDADE (HyperFrames, da HeyGen) — está na pasta "${NOME_GUIA}/" e você pode abrir os arquivos com a ferramenta Read.`,
  'ANTES de escrever o código, consulte (leitura rápida, só o que servir para ESTE vídeo):',
  `1. ${NOME_GUIA}/references/motion.md (eases por papel, tempos de entrada/saída, stagger, títulos, cortes, transições e os "defaults que parecem gerados") — o mais importante.`,
  `2. O arquivo do tipo deste vídeo em ${NOME_GUIA}/references/types/: launch.md (lançamento, promo), explainer.md (explicativo, tutorial), data.md (gráficos, números), vertical.md (9:16, Reels/TikTok), 3d.md (3D, generativo), character.md (personagem, mascote) ou music.md (clipe). Abra só o que combinar.`,
  `3. Se o vídeo conta algo (mais de ~15 s): as seções "The hook" e "Beats" de ${NOME_GUIA}/references/story.md.`,
  `4. Se o usuário não definiu cores/fontes: escolha um preset em ${NOME_GUIA}/assets/frame-presets/<nome>/FRAME.md (cores, tipografia e composições prontas) e siga-o.`,
  `5. Para GSAP: a seção "GSAP facts that bite" de ${NOME_GUIA}/references/runtimes.md.`,
  'COMO ADAPTAR AO NOSSO FORMATO (importante — não é um projeto HyperFrames):',
  '- Entregue o HTML único de sempre (sem data-composition-id, data-start, class="clip", sub-composições nem CLI).',
  '- Ignore o que o guia manda fazer fora do código: comandos npx hyperframes, registry, Studio/desktop app, SPEC.md, REVIEW.md, propor 3 roteiros ou esperar o usuário escolher. Você decide e entrega.',
  '- Monte UMA timeline GSAP principal, registre em window.__timelines = { main: tl } e chame tl.play() ao final do script (ela precisa tocar sozinha).',
  '- Siga as regras de determinismo do guia: sem Math.random sem semente, sem Date.now; fromTo com estados iniciais explícitos; anime transform/opacity (não width/height/top/left).',
  '- Use o RITMO do guia (conteúdo chegando ao longo do tempo, entradas variadas, título parado depois que pousa, nada parado nem tudo de uma vez em t=0).',
  '- Não gaste a resposta resumindo o guia: leia, decida e entregue o HTML.',
].join('\n');
