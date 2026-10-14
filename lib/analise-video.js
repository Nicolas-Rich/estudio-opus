// "Assiste" o vídeo para a sonoplastia: cortes de cena, curva de movimento (com lado
// esquerda/direita), flashes de luz, trechos calmos e folhas de quadros com tempo
// (imagens que a IA vê). Tudo com ffmpeg sobre uma versão pequena do vídeo.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FFMPEG } from './ffmpeg.js';

function rodar(args, cwd) {
  return new Promise((ok, falha) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok() : falha(new Error('ffmpeg: ' + err.slice(-500)))));
  });
}

/** Lê a saída de metadata=print: [{ t, v }] */
async function lerMetadata(arq, chave) {
  const txt = await fs.readFile(arq, 'utf8').catch(() => '');
  const out = [];
  let t = null;
  for (const linha of txt.split(/\r?\n/)) {
    const m = /pts_time:([\d.]+)/.exec(linha);
    if (m) { t = +m[1]; continue; }
    if (t != null && linha.startsWith(chave + '=')) { out.push({ t, v: +linha.split('=')[1] }); t = null; }
  }
  return out;
}

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * video: arquivo de vídeo (qualquer tamanho). pasta: onde guardar folhas e arquivos de trabalho.
 * Devolve { duracao, cortes, picos, flashes, calmarias, curva, folhas, resumo }.
 */
export async function analisarVideo({ video, pasta, duracao }) {
  video = path.resolve(video);
  pasta = path.resolve(pasta);
  await fs.mkdir(pasta, { recursive: true });
  // versão minúscula a 10 fps para medir movimento rápido
  await rodar(['-y', '-i', video, '-vf', 'fps=10,scale=96:-2', '-an', 'pequeno.mp4'], pasta);
  const mov = (arq, crop) => rodar(['-i', 'pequeno.mp4', '-vf', `${crop ? crop + ',' : ''}tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${arq}`, '-f', 'null', '-'], pasta);
  await Promise.all([
    mov('mov.txt'),
    mov('mov-e.txt', 'crop=iw/2:ih:0:0'),
    mov('mov-d.txt', 'crop=iw/2:ih:iw/2:0'),
    rodar(['-i', 'pequeno.mp4', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=luz.txt', '-f', 'null', '-'], pasta),
    rodar(['-i', 'pequeno.mp4', '-vf', "select='gt(scene,0.22)',metadata=print:file=cortes.txt", '-f', 'null', '-'], pasta),
  ]);
  const movTot = await lerMetadata(path.join(pasta, 'mov.txt'), 'lavfi.signalstats.YAVG');
  const movE = await lerMetadata(path.join(pasta, 'mov-e.txt'), 'lavfi.signalstats.YAVG');
  const movD = await lerMetadata(path.join(pasta, 'mov-d.txt'), 'lavfi.signalstats.YAVG');
  const luz = await lerMetadata(path.join(pasta, 'luz.txt'), 'lavfi.signalstats.YAVG');
  const cortesRaw = await lerMetadata(path.join(pasta, 'cortes.txt'), 'lavfi.scene_score');
  const dur = duracao || (movTot.at(-1)?.t || 0) + 0.1;

  // curva de movimento normalizada 0–1 (pelo percentil 95, para um pico isolado não achatar tudo)
  const vals = movTot.map((x) => x.v);
  const ord = [...vals].sort((a, b) => a - b);
  const p95 = Math.max(4, ord[Math.floor(ord.length * 0.95)] || 1);
  const norm = vals.map((v) => Math.min(1, v / p95));
  const suav = norm.map((_, i) => (norm[i - 1] ?? norm[i]) * 0.25 + norm[i] * 0.5 + (norm[i + 1] ?? norm[i]) * 0.25);

  // picos de movimento: máximos locais acima de 0,35, separados por ≥ 0,35 s
  const candidatos = [];
  for (let i = 1; i < suav.length - 1; i++) {
    if (suav[i] >= 0.35 && suav[i] >= suav[i - 1] && suav[i] >= suav[i + 1]) {
      const e = movE[i]?.v || 0;
      const d = movD[i]?.v || 0;
      candidatos.push({ t: r2(movTot[i].t), intensidade: r2(suav[i]), lado: e + d > 0 ? r2((d - e) / (d + e)) : 0 });
    }
  }
  candidatos.sort((a, b) => b.intensidade - a.intensidade);
  const picos = [];
  for (const c of candidatos) {
    if (picos.length >= 30) break;
    if (picos.every((p) => Math.abs(p.t - c.t) >= 0.35)) picos.push(c);
  }
  picos.sort((a, b) => a.t - b.t);

  // flashes: salto de brilho entre quadros
  const flashes = [];
  for (let i = 1; i < luz.length; i++) {
    const salto = luz[i].v - luz[i - 1].v;
    if (Math.abs(salto) >= 28 && flashes.every((f) => Math.abs(f.t - luz[i].t) > 0.4)) {
      flashes.push({ t: r2(luz[i].t), tipo: salto > 0 ? 'clareia' : 'escurece', forca: r2(Math.min(1, Math.abs(salto) / 120)) });
    }
  }

  // cortes de cena
  const cortes = [];
  for (const c of cortesRaw) {
    if (cortes.every((x) => Math.abs(x.t - c.t) > 0.3)) cortes.push({ t: r2(c.t), forca: r2(Math.min(1, c.v)) });
  }

  // trechos calmos (pouco movimento por ≥ 1,2 s): bons para respiro / ambiência
  const calmarias = [];
  let ini = null;
  suav.forEach((v, i) => {
    const t = movTot[i].t;
    if (v < 0.12) { if (ini == null) ini = t; } else if (ini != null) {
      if (t - ini >= 1.2) calmarias.push({ inicio: r2(ini), fim: r2(t) });
      ini = null;
    }
  });
  if (ini != null && dur - ini >= 1.2) calmarias.push({ inicio: r2(ini), fim: r2(dur) });

  // curva compacta a cada 0,25 s (para a tela e para a IA)
  const curva = [];
  for (let t = 0; t < dur; t += 0.25) {
    const janela = suav.filter((_, i) => movTot[i].t >= t && movTot[i].t < t + 0.25);
    curva.push(r2(janela.length ? Math.max(...janela) : 0));
  }

  // folhas de quadros com tempo (no máx. ~6 folhas de 6×3)
  const fpsFolha = Math.min(2, Math.max(0.3, 100 / dur));
  const roteiroFolha = `fps=${fpsFolha.toFixed(3)},scale=200:-2,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='%{pts\\:hms}':x=6:y=6:fontsize=16:fontcolor=yellow:box=1:boxcolor=black@0.7,tile=6x3:padding=4:color=0x222222`;
  await fs.writeFile(path.join(pasta, 'folha.txt'), roteiroFolha, 'utf8');
  for (const f of await fs.readdir(pasta)) if (/^folha-\d+\.png$/.test(f)) await fs.rm(path.join(pasta, f));
  await rodar(['-y', '-i', video, '-filter_script:v', 'folha.txt', '-an', '-vsync', 'vfr', 'folha-%02d.png'], pasta);
  const folhas = (await fs.readdir(pasta)).filter((f) => /^folha-\d+\.png$/.test(f)).sort();

  const ladoTxt = (l) => (l < -0.25 ? 'E' : l > 0.25 ? 'D' : 'C');
  const resumo = [
    `Duração: ${dur.toFixed(2)} s.`,
    `Cortes de cena (troca brusca de imagem, força 0–1): ${cortes.map((c) => `${c.t}s(${c.forca})`).join(', ') || 'nenhum'}.`,
    `Picos de movimento (tempo, intensidade 0–1, lado E=esquerda C=centro D=direita): ${picos.map((p) => `${p.t}s ${p.intensidade} ${ladoTxt(p.lado)}`).join(' · ') || 'nenhum'}.`,
    `Flashes de luz: ${flashes.map((f) => `${f.t}s ${f.tipo}(${f.forca})`).join(', ') || 'nenhum'}.`,
    `Trechos calmos: ${calmarias.map((c) => `${c.inicio}–${c.fim}s`).join(', ') || 'nenhum'}.`,
    `Curva de movimento a cada 0,5 s (0 parado … 9 muito agitado): ${curva.filter((_, i) => i % 2 === 0).map((v) => Math.round(v * 9)).join(' ')}.`,
  ].join('\n');

  for (const f of ['pequeno.mp4', 'mov.txt', 'mov-e.txt', 'mov-d.txt', 'luz.txt', 'cortes.txt', 'folha.txt']) await fs.rm(path.join(pasta, f), { force: true });
  return { duracao: r2(dur), cortes, picos, flashes, calmarias, curva, folhas, resumo };
}
