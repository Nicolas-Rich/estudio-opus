// Estúdio Opus — front-end (vanilla JS).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtT = (s) => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const quando = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function api(url, opcoes = {}) {
  const o = { ...opcoes };
  if (o.corpo !== undefined) {
    o.method = o.method || 'POST';
    o.headers = { 'Content-Type': 'application/json' };
    o.body = JSON.stringify(o.corpo);
  }
  const r = await fetch(url, o);
  const tipo = r.headers.get('content-type') || '';
  const dado = tipo.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(dado?.erro || dado || `Erro ${r.status}`);
  return dado;
}

function toast(msg, tipo = '') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 8000 : 4000);
}

// acompanha um job até terminar
function acompanharJob(id, aoAtualizar) {
  return new Promise((ok) => {
    const tick = async () => {
      try {
        const j = await api(`/api/jobs/${id}`);
        aoAtualizar?.(j);
        if (j.status === 'ok' || j.status === 'erro') return ok(j);
      } catch (e) {
        aoAtualizar?.({ status: 'erro', erro: e.message });
        return ok({ status: 'erro', erro: e.message });
      }
      setTimeout(tick, 1000);
    };
    tick();
  });
}

const FORMATOS = [
  { id: '9:16', nome: 'Reels / TikTok / Stories', curto: '9:16', largura: 1080, altura: 1920 },
  { id: '4:5', nome: 'Feed Instagram', curto: '4:5', largura: 1080, altura: 1350 },
  { id: '1:1', nome: 'Quadrado', curto: '1:1', largura: 1080, altura: 1080 },
  { id: '16:9', nome: 'YouTube / horizontal', curto: '16:9', largura: 1920, altura: 1080 },
];
const formatoPorId = (id) => FORMATOS.find((f) => f.id === id) || FORMATOS[0];
const IDIOMAS = ['Português do Brasil', 'Inglês', 'Espanhol', 'Manter o idioma do prompt'];

const estado = {
  vista: 'modelos',
  modelos: [],
  categorias: {},
  filtrados: [],
  mostrados: 0,
  modelosClaude: [],
  projetos: [],
  projetoAberto: null,
  abaProjeto: 'refinar',
  midias: [],
  filtroMidia: '',
};

// ===================================================================== navegação
function irPara(vista) {
  estado.vista = vista;
  $$('.abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.vista === vista));
  $$('.vista').forEach((v) => v.classList.toggle('ativa', v.id === `vista-${vista}`));
  if (vista === 'projetos' && !estado.projetoAberto) carregarProjetos();
  if (vista === 'voz') abrirEstudioVoz();
  if (vista === 'kie') abrirKie();
  if (vista === 'gerador') abrirGerador();
  if (vista === 'editor') { carregarMidia().then(() => { ajustarPalco(); mostrarQuadro(); }); ajustarPalco(); }
  history.replaceState(null, '', `#${vista}${vista === 'projetos' && estado.projetoAberto ? '/' + estado.projetoAberto : ''}`);
}
$$('.abas button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.vista === 'projetos') fecharProjeto(false);
  irPara(b.dataset.vista);
}));

// ===================================================================== status
async function carregarStatus() {
  try {
    const s = await api('/api/status');
    estado.modelosClaude = s.modelosClaude;
    const el = $('#statusClaude');
    if (s.claude) { el.textContent = `Claude ${s.claude.split(' ')[0]} ✓${s.codex ? ' · Codex ✓' : ''}`; el.className = 'chip ok'; el.title = [s.claude, s.codex].filter(Boolean).join(' | '); }
    else { el.textContent = 'Claude CLI não encontrado'; el.className = 'chip erro'; el.title = 'Instale o Claude Code e faça login'; }
  } catch {}
}
setInterval(async () => {
  try {
    const ativos = await api('/api/jobs');
    const el = $('#tarefasAtivas');
    el.hidden = !ativos.length;
    if (ativos.length) {
      const n = (t) => ativos.filter((j) => j.tipo === t).length;
      const g = n('geracao');
      const r = n('render') + n('exportacao');
      const a = n('audio');
      const k = n('kie');
      const i = n('gerador');
      el.textContent = [g && `${g} gerando`, a && `${a} no áudio`, k && `${k} no Kie.ai`, i && 'instalando o Opus Generator', r && `${r} renderizando`].filter(Boolean).join(' · ');
    }
  } catch {}
}, 3000);

// ===================================================================== MODELOS
const LOTE = 48;
async function carregarModelos() {
  const d = await api('/api/modelos');
  estado.modelos = d.modelos;
  estado.categorias = d.categorias;
  $('#contModelos').textContent = d.modelos.length;
  $('#busca').placeholder = `Buscar nos ${d.modelos.length} prompts (ex.: logo, partículas, 3D, produto, tipografia)…`;
  const cont = {};
  const tags = {};
  for (const m of d.modelos) {
    cont[m.categoria] = (cont[m.categoria] || 0) + 1;
    for (const t of m.tags) tags[t] = (tags[t] || 0) + 1;
  }
  $('#chipsCategoria').innerHTML = `<button data-cat="" class="ativa">Todos <small>${d.modelos.length}</small></button>`
    + Object.entries(d.categorias).map(([k, v]) => `<button data-cat="${k}">${v} <small>${cont[k] || 0}</small></button>`).join('');
  $('#filtroTag').innerHTML = '<option value="">Toda tecnologia</option>'
    + Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<option value="${t}">${t} (${n})</option>`).join('');
  filtrarModelos();
}

let categoriaAtiva = '';
$('#chipsCategoria').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  categoriaAtiva = b.dataset.cat;
  $$('#chipsCategoria button').forEach((x) => x.classList.toggle('ativa', x === b));
  filtrarModelos();
});
let tBusca;
$('#busca').addEventListener('input', () => { clearTimeout(tBusca); tBusca = setTimeout(filtrarModelos, 150); });
$('#filtroTag').addEventListener('change', filtrarModelos);
$('#soCompletos').addEventListener('change', filtrarModelos);

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function filtrarModelos() {
  const termos = normalizar($('#busca').value).split(/\s+/).filter(Boolean);
  const tag = $('#filtroTag').value;
  const completos = $('#soCompletos').checked;
  estado.filtrados = estado.modelos.filter((m) => {
    if (categoriaAtiva && m.categoria !== categoriaAtiva) return false;
    if (tag && !m.tags.includes(tag)) return false;
    if (completos && m.parcial) return false;
    if (termos.length) {
      const alvo = normalizar(`${m.prompt} ${m.autor} ${m.tags.join(' ')}`);
      return termos.every((t) => alvo.includes(t));
    }
    return true;
  });
  estado.mostrados = 0;
  $('#gradeModelos').innerHTML = '';
  $('#contagemModelos').textContent = `${estado.filtrados.length} modelos`;
  mostrarMaisModelos();
}

function cardModelo(m) {
  const linha = m.prompt.replace(/\s+/g, ' ').slice(0, 220);
  return `<article class="card-modelo" data-slug="${m.slug}">
    <div class="poster"><img loading="lazy" src="/poster/${m.slug}" alt="" onerror="this.style.opacity=0">
      <span class="cat">${esc(estado.categorias[m.categoria] || m.categoria)}</span>
      ${m.parcial ? '<span class="parcial">prompt parcial</span>' : ''}
    </div>
    <div class="card-corpo">
      <div class="card-autor">@${esc(m.autor)}</div>
      <div class="card-prompt">${esc(linha)}</div>
      <div class="tags">${m.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
    </div>
  </article>`;
}
function mostrarMaisModelos() {
  const prox = estado.filtrados.slice(estado.mostrados, estado.mostrados + LOTE);
  $('#gradeModelos').insertAdjacentHTML('beforeend', prox.map(cardModelo).join(''));
  estado.mostrados += prox.length;
}
new IntersectionObserver((ent) => {
  if (ent[0].isIntersecting && estado.mostrados < estado.filtrados.length) mostrarMaisModelos();
}, { rootMargin: '600px' }).observe($('#sentinela'));

$('#gradeModelos').addEventListener('click', (e) => {
  const c = e.target.closest('.card-modelo');
  if (c) abrirModelo(estado.modelos.find((m) => m.slug === c.dataset.slug));
});

$('#btnAtualizarRepo').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('/api/modelos/atualizar', { method: 'POST' });
    toast(`Repositório atualizado: ${r.total} modelos. ${r.saida.split('\n').pop()}`, 'ok');
    await carregarModelos();
  } catch (err) { toast('Falha ao atualizar: ' + err.message, 'erro'); }
  e.target.disabled = false;
});

// ---------- modal de criação
function fecharModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; try { audioAmostra.pause(); } catch {} }
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') fecharModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) fecharModal(); });

function formularioCriacao(m) {
  const ult = JSON.parse(localStorage.getItem('ultimosAjustes') || '{}');
  const fmt = ult.formato || '9:16';
  return `
    <div class="campos">
      <div class="caixa-ideia">
        <label>💡 Sua ideia (em poucas palavras)
          <textarea id="fIdeia" rows="2" placeholder="Ex.: meu produto girando em câmera lenta, partículas douradas, texto 'frete grátis', final com o logo"></textarea>
        </label>
        <div class="linha" style="align-items:center">
          <button type="button" class="btn" id="fGerarPrompt" style="flex:none">✦ Gerar prompt da minha ideia</button>
          <button type="button" class="btn mini fantasma" id="fDesfazerPrompt" style="flex:none" hidden>↶ desfazer</button>
          <span class="ajuda" id="fIdeiaMsg" style="margin:0">${m ? 'Usa o estilo deste modelo + a sua ideia.' : 'O Claude escreve um prompt completo, com cenas e tempos.'}</span>
        </div>
      </div>
      <div class="caixa-imagens">
        <div class="linha" style="align-items:center">
          <b style="flex:1">🖼 Imagens (opcional)</b>
          <label class="btn mini" style="flex:none">＋ Adicionar imagens<input type="file" id="fImagens" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"></label>
          <label class="btn mini" style="flex:none" title="Envie um vídeo para a IA recriar igual">🎞 Vídeo de referência<input type="file" id="fVideoRef" hidden accept="video/*,.gif"></label>
        </div>
        <div id="fVideoRefBox" hidden></div>
        ${m ? '<label class="check"><input type="checkbox" id="fFiel" checked> ficar <b>fiel ao visual do vídeo original</b> (a IA vê um quadro dele)</label>' : ''}
        <p class="ajuda" style="margin:0"><b>Elemento</b> = entra no vídeo (logo, produto, foto). <b>Referência</b> = o Claude só copia o estilo. Ele vê as imagens antes de criar.</p>
        <div id="fListaImagens" class="lista-imagens"></div>
      </div>
      <label>Prompt ${m ? '(edite à vontade — é o ponto de partida)' : ''}
        <textarea id="fPrompt" rows="${m ? 9 : 7}" placeholder="Descreva a animação: estilo, cenas, ritmo, tipografia…">${esc(m?.prompt || '')}</textarea>
      </label>
      ${m?.parcial ? '<div class="aviso">O autor publicou só parte do prompt. O Claude completa o que faltar a partir da ideia.</div>' : ''}
      <label>Tema / marca / produto
        <input type="text" id="fTema" value="${esc(ult.tema || '')}" placeholder="Ex.: Minha Marca — nome do produto ou serviço">
      </label>
      <label>Textos que aparecem no vídeo (opcional)
        <input type="text" id="fTextos" placeholder='Ex.: "30g de proteína" → "Zero açúcar" → "Compre agora"'>
      </label>
      <label>Formato
        <div class="formatos" id="fFormatos">
          ${FORMATOS.map((f) => {
            const e = 28 / Math.max(f.largura, f.altura);
            return `<button type="button" class="formato ${f.id === fmt ? 'ativa' : ''}" data-id="${f.id}">
              <i style="width:${Math.round(f.largura * e)}px;height:${Math.round(f.altura * e)}px"></i>${f.curto}<small>${f.nome}</small></button>`;
          }).join('')}
        </div>
      </label>
      <div class="linha">
        <label>Duração (s)<input type="number" id="fDuracao" min="2" max="120" value="${ult.duracao || 10}"></label>
        <label>Idioma dos textos
          <select id="fIdioma">${IDIOMAS.map((i) => `<option ${i === (ult.idioma || IDIOMAS[0]) ? 'selected' : ''}>${i}</option>`).join('')}</select>
        </label>
      </div>
      <label>Paleta / identidade visual (opcional)
        <input type="text" id="fCores" value="${esc(ult.cores || '')}" placeholder="Ex.: preto, laranja #FF6A3D e branco; fonte bold condensada">
      </label>
      <label>Instruções extras (opcional)
        <textarea id="fExtra" rows="3" placeholder="Ex.: termine com o logo centralizado por 2 segundos — ou escreva o que quer e clique em Sugerir"></textarea>
        <button type="button" class="btn mini" id="fSugerirExtras" style="margin-top:6px">✦ Sugerir instruções extras</button>
        <span class="ajuda" id="fExtrasMsg"></span>
      </label>
      <div class="linha">
        <label>Modelo do Claude
          <select id="fModelo">${estado.modelosClaude.map((x) => `<option value="${x.id}" ${x.id === ult.modelo ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
        </label>
        <label>Nome do projeto
          <input type="text" id="fNome" placeholder="${esc(m ? 'Modelo @' + m.autor : 'Novo vídeo')}">
        </label>
      </div>
      <label>Já tem a locução gravada? (opcional)
        <input type="file" id="fLocucao" accept="audio/*,video/*">
      </label>
      <p class="ajuda" style="margin:-6px 0 0">Se enviar, o estúdio transcreve a sua fala com o tempo de cada palavra, a duração do vídeo vira a do áudio e a animação já nasce sincronizada com o que você fala.</p>
      <button class="btn primario" id="fGerar" style="justify-content:center;padding:12px">✦ Gerar animação com Claude</button>
      <p class="ajuda">Usa o Claude Code instalado neste PC (sua assinatura). A geração leva de 1 a 6 minutos; você pode continuar usando o estúdio enquanto isso.</p>
    </div>`;
}

function ligarFormulario(m) {
  $$('#fFormatos .formato').forEach((b) => b.addEventListener('click', () => {
    $$('#fFormatos .formato').forEach((x) => x.classList.toggle('ativa', x === b));
  }));

  // ---------- imagens (elementos e referências)
  const imagens = [];
  const desenharImagens = () => {
    $('#fListaImagens').innerHTML = imagens.map((im, i) => `<div class="img-item">
      <img src="${im.url}" alt="">
      <div>
        <div class="chips pequenos" data-i="${i}">
          <button type="button" data-papel="elemento" class="${im.papel === 'elemento' ? 'ativa' : ''}">Elemento</button>
          <button type="button" data-papel="referencia" class="${im.papel === 'referencia' ? 'ativa' : ''}">Referência</button>
        </div>
        <input type="text" data-desc="${i}" value="${esc(im.descricao)}" placeholder="O que é? (ex.: logo da marca, foto do produto)">
      </div>
      <button type="button" class="btn mini perigo" data-rem="${i}">✕</button></div>`).join('');
  };
  $('#fImagens').onchange = async (e) => {
    for (const f of e.target.files) {
      try {
        const r = await fetch(`/api/imagens?nome=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        const ehLogo = /logo|marca|produto|product/i.test(f.name);
        imagens.push({ ...d, papel: ehLogo || !imagens.length ? 'elemento' : 'referencia', descricao: ehLogo ? f.name.replace(/.[a-z]+$/i, '') : '' });
      } catch (err) { toast(`${f.name}: ${err.message}`, 'erro'); }
    }
    e.target.value = '';
    desenharImagens();
  };
  $('#fListaImagens').addEventListener('click', (e) => {
    const p = e.target.closest('[data-papel]');
    if (p) { imagens[+p.parentElement.dataset.i].papel = p.dataset.papel; desenharImagens(); }
    const r = e.target.closest('[data-rem]');
    if (r) { imagens.splice(+r.dataset.rem, 1); desenharImagens(); }
  });
  $('#fListaImagens').addEventListener('input', (e) => { if (e.target.dataset.desc != null) imagens[+e.target.dataset.desc].descricao = e.target.value; });
  const imagensPayload = () => imagens.map(({ id, papel, descricao }) => ({ id, papel, descricao }));

  // ---------- vídeo de referência (recriar igual)
  let videoRef = null;
  const desenharVideoRef = () => {
    const box = $('#fVideoRefBox');
    box.hidden = !videoRef;
    if (!videoRef) { box.innerHTML = ''; return; }
    const r = videoRef;
    box.innerHTML = `<div class="ref-video">
      <div class="ref-topo"><b>🎞 ${esc(r.nomeOriginal)}</b><span class="mono">${r.duracao.toFixed(1)}s · ${r.largura}×${r.altura} · ${r.quadros.length} quadros</span>
        <button type="button" class="btn mini perigo" id="fVideoRefRem">✕</button></div>
      <div class="ref-quadros">${r.quadros.map((q) => `<figure><img src="${q.url}" alt=""><figcaption>${q.t.toFixed(1)}s</figcaption></figure>`).join('')}</div>
      <p class="ajuda" style="margin:0">A IA vai ver esses quadros em sequência e recriar o vídeo com as mesmas cenas, tempos e estilo, trocando o conteúdo pela sua marca.</p>
    </div>`;
    $('#fVideoRefRem').onclick = () => { videoRef = null; desenharVideoRef(); };
  };
  $('#fVideoRef').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const box = $('#fVideoRefBox');
    box.hidden = false;
    box.innerHTML = '<p class="ajuda" style="margin:0">Enviando e extraindo os quadros do vídeo…</p>';
    try {
      const r = await fetch(`/api/video-referencia?nome=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      videoRef = d;
      // ajusta duração e formato para bater com o vídeo enviado
      $('#fDuracao').value = Math.max(2, Math.round(d.duracao));
      const prop = d.largura / d.altura;
      const fmt = FORMATOS.reduce((a, b) => (Math.abs(b.largura / b.altura - prop) < Math.abs(a.largura / a.altura - prop) ? b : a));
      $$('#fFormatos .formato').forEach((x) => x.classList.toggle('ativa', x.dataset.id === fmt.id));
      desenharVideoRef();
      toast(`Vídeo de referência pronto: ${d.quadros.length} quadros. Duração e formato ajustados para ${Math.round(d.duracao)}s · ${fmt.curto}.`, 'ok');
    } catch (err) {
      videoRef = null;
      box.innerHTML = `<div class="erro-caixa">${esc(err.message)}</div>`;
    }
  };

  // ---------- assistente: ideia → prompt, e sugestão de instruções extras
  const ajustesDoForm = () => {
    const f = formatoPorId($('#fFormatos .ativa')?.dataset.id);
    return {
      largura: f.largura, altura: f.altura, formatoNome: `${f.curto} ${f.nome}`,
      duracao: +$('#fDuracao').value || 10,
      idioma: $('#fIdioma').value === IDIOMAS[3] ? '' : $('#fIdioma').value,
      tema: $('#fTema').value.trim(), textos: $('#fTextos').value.trim(), cores: $('#fCores').value.trim(),
    };
  };
  let promptAnterior = null;
  $('#fGerarPrompt').onclick = async () => {
    const ideia = $('#fIdeia').value.trim();
    if (!ideia && !m && !$('#fTema').value.trim()) return toast('Escreva a sua ideia (ou pelo menos o tema/produto).', 'erro');
    const b = $('#fGerarPrompt');
    b.disabled = true;
    b.textContent = 'Claude escrevendo o prompt…';
    try {
      const r = await api('/api/assistente', { corpo: { tipo: 'prompt', ideia, slug: $('#fFiel')?.checked === false ? undefined : m?.slug, ajustes: ajustesDoForm(), imagens: imagensPayload(), videoRef: videoRef?.id, modelo: $('#fModelo').value } });
      promptAnterior = $('#fPrompt').value;
      $('#fPrompt').value = r.texto;
      $('#fDesfazerPrompt').hidden = false;
      $('#fIdeiaMsg').textContent = 'Prompt gerado — revise e ajuste à vontade. Pode clicar de novo para outra versão.';
    } catch (e) { toast(e.message, 'erro'); }
    b.disabled = false;
    b.textContent = '✦ Gerar prompt da minha ideia';
  };
  $('#fDesfazerPrompt').onclick = () => {
    if (promptAnterior == null) return;
    $('#fPrompt').value = promptAnterior;
    promptAnterior = null;
    $('#fDesfazerPrompt').hidden = true;
  };
  $('#fSugerirExtras').onclick = async () => {
    const b = $('#fSugerirExtras');
    b.disabled = true;
    b.textContent = 'Claude pensando…';
    try {
      const r = await api('/api/assistente', {
        corpo: { tipo: 'extras', prompt: $('#fPrompt').value, ideiaExtra: $('#fExtra').value, ajustes: ajustesDoForm(), modelo: $('#fModelo').value },
      });
      $('#fExtra').value = r.texto;
      $('#fExtra').rows = Math.min(9, r.texto.split('\n').length + 1);
      $('#fExtrasMsg').textContent = ' Sugestões prontas — apague as que não quiser.';
    } catch (e) { toast(e.message, 'erro'); }
    b.disabled = false;
    b.textContent = '✦ Sugerir instruções extras';
  };
  $('#fGerar').addEventListener('click', async () => {
    const prompt = $('#fPrompt').value.trim() || (videoRef ? 'Recrie o vídeo de referência enviado: mesma sequência de cenas, mesmos tempos, mesmo estilo visual e de movimento, trocando o conteúdo pela minha marca.' : '');
    if (!prompt && !videoRef) return toast('Escreva um prompt (ou envie um vídeo de referência).', 'erro');
    const f = formatoPorId($('#fFormatos .ativa')?.dataset.id);
    const ajustes = {
      largura: f.largura, altura: f.altura, formatoNome: `${f.curto} ${f.nome}`, formato: f.id,
      duracao: Math.max(2, +$('#fDuracao').value || 10),
      idioma: $('#fIdioma').value === IDIOMAS[3] ? '' : $('#fIdioma').value,
      tema: $('#fTema').value.trim(), textos: $('#fTextos').value.trim(),
      cores: $('#fCores').value.trim(), extra: $('#fExtra').value.trim(),
    };
    localStorage.setItem('ultimosAjustes', JSON.stringify({
      formato: f.id, duracao: ajustes.duracao, idioma: $('#fIdioma').value, tema: ajustes.tema, cores: ajustes.cores, modelo: $('#fModelo').value,
    }));
    $('#fGerar').disabled = true;
    const rotuloOriginal = $('#fGerar').textContent;
    try {
      let locucao;
      const arqLocucao = $('#fLocucao').files[0];
      if (arqLocucao) {
        $('#fGerar').textContent = 'Enviando a locução…';
        const q = new URLSearchParams({ nome: arqLocucao.name, dica: [ajustes.tema, ajustes.textos].filter(Boolean).join('. ') });
        const r0 = await fetch(`/api/audio/locucao?${q}`, { method: 'POST', body: arqLocucao });
        const d0 = await r0.json();
        if (!r0.ok) throw new Error(d0.erro);
        const fim = await acompanharJob(d0.job.id, (j) => { if ($('#fGerar')) $('#fGerar').textContent = j.ultima || 'Transcrevendo…'; });
        if (fim.status !== 'ok') throw new Error('Transcrição falhou: ' + fim.erro);
        locucao = fim.resultado.locucao;
        $('#fGerar').textContent = `Locução transcrita (${fim.resultado.duracao.toFixed(1)}s) — criando…`;
      }
      const r = await api('/api/projetos', { corpo: { slug: m?.slug, prompt, ajustes, modelo: $('#fModelo').value, nome: $('#fNome').value.trim(), locucao, imagens: imagensPayload(), videoRef: videoRef?.id, fiel: $('#fFiel') ? $('#fFiel').checked : false } });
      fecharModal();
      toast('Geração iniciada! Acompanhe no projeto.', 'ok');
      abrirProjeto(r.projeto.id);
    } catch (e) {
      toast(e.message, 'erro');
      $('#fGerar').disabled = false;
      $('#fGerar').textContent = rotuloOriginal;
    }
  });
}

function abrirModelo(m) {
  $('#modal').innerHTML = `<div class="modal-caixa">
    <button class="fechar" aria-label="Fechar">×</button>
    <div class="modal-esq">
      <div class="poster"><img src="/poster/${m.slug}" alt=""></div>
      <div>
        <h2>@${esc(m.autor)} · ${esc(estado.categorias[m.categoria])}</h2>
        <div class="tags">${m.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
      </div>
      <div class="linha" style="flex:none">
        <a class="btn" href="${m.post}" target="_blank" rel="noopener">Ver vídeo original ↗</a>
        <a class="btn" href="${m.skillry}" target="_blank" rel="noopener">Remake ao vivo ↗</a>
      </div>
      <b style="font-size:12px;color:var(--texto-2)">PROMPT ORIGINAL</b>
      <div class="prompt-original">${esc(m.prompt)}</div>
    </div>
    <div class="modal-dir">
      <h2>Usar este modelo</h2>
      ${formularioCriacao(m)}
    </div>
  </div>`;
  $('#modal').hidden = false;
  $('#modal .fechar').onclick = fecharModal;
  ligarFormulario(m);
}

$('#btnDoZero').addEventListener('click', () => {
  $('#modal').innerHTML = `<div class="modal-caixa simples"><button class="fechar">×</button>
    <div class="modal-dir"><h2>Criar animação do zero</h2>${formularioCriacao(null)}</div></div>`;
  $('#modal').hidden = false;
  $('#modal .fechar').onclick = fecharModal;
  ligarFormulario(null);
});

// ===================================================================== PROJETOS
async function carregarProjetos() {
  estado.projetos = await api('/api/projetos');
  $('#contProjetos').textContent = estado.projetos.length;
  const g = $('#gradeProjetos');
  if (!estado.projetos.length) {
    g.innerHTML = `<div class="vazio-grande" style="grid-column:1/-1">Nenhum projeto ainda.<br><br>
      Escolha um modelo na aba <b>Modelos</b> e clique em “Gerar animação com Claude”.</div>`;
    return;
  }
  g.innerHTML = estado.projetos.map((p) => `<article class="card-projeto" data-id="${p.id}">
    <div class="capa">${p.capa ? `<img src="/api/projetos/${p.id}/capa?${p.capa}" alt="">`
      : p.status === 'gerando' ? '<div class="gerando"><div class="spinner"></div>Claude escrevendo…</div>' : '<div class="gerando" style="color:var(--texto-3)">sem capa</div>'}</div>
    <div class="card-corpo">
      <div class="card-autor">${esc(p.nome)}</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span class="status ${p.status}">${{ pronto: 'pronto', gerando: 'gerando…', erro: 'erro' }[p.status]}</span>
        <small class="mono">${p.ajustes.formato || ''} · ${p.ajustes.duracao}s · v${p.versaoAtual || 0}</small>
      </div>
      <small style="color:var(--texto-3)">${quando(p.atualizado)}${p.autor ? ' · modelo @' + esc(p.autor) : ''}</small>
    </div>
  </article>`).join('');
  if (estado.projetos.some((p) => p.status === 'gerando') && estado.vista === 'projetos' && !estado.projetoAberto) {
    clearTimeout(carregarProjetos.t);
    carregarProjetos.t = setTimeout(carregarProjetos, 4000);
  }
}
$('#gradeProjetos').addEventListener('click', (e) => {
  const c = e.target.closest('.card-projeto');
  if (c) abrirProjeto(c.dataset.id);
});

let pollProjeto;
function fecharProjeto(recarregar = true) {
  estado.projetoAberto = null;
  clearTimeout(pollProjeto);
  $('#detalheProjeto').hidden = true;
  $('#detalheProjeto').innerHTML = '';
  $('#listaProjetos').hidden = false;
  if (recarregar) { carregarProjetos(); history.replaceState(null, '', '#projetos'); }
}

async function abrirProjeto(id) {
  estado.projetoAberto = id;
  irPara('projetos');
  $('#listaProjetos').hidden = true;
  $('#detalheProjeto').hidden = false;
  await renderizarDetalhe(true);
}

let ultimoEstadoProjeto = '';
async function renderizarDetalhe(completo = false) {
  clearTimeout(pollProjeto);
  const id = estado.projetoAberto;
  if (!id) return;
  let p;
  try { p = await api(`/api/projetos/${id}`); } catch (e) { toast(e.message, 'erro'); return fecharProjeto(); }
  if (estado.projetoAberto !== id) return;
  const chave = `${p.status}|${p.versaoAtual}|${p.versoes.length}|${(p.renders || []).length}`;
  const el = $('#detalheProjeto');
  if (completo || chave !== ultimoEstadoProjeto || !$('#pvArea', el)) {
    ultimoEstadoProjeto = chave;
    desenharDetalhe(p);
  }
  // progresso ao vivo da geração
  const ov = $('#ovGerando');
  if (ov) {
    ov.hidden = p.status !== 'gerando';
    if (p.job) $('#ovMsg').textContent = p.job.ultima || 'Aguardando o Claude…';
  }
  if (p.status === 'gerando') pollProjeto = setTimeout(() => renderizarDetalhe(), 1200);
}

function desenharDetalhe(p) {
  const el = $('#detalheProjeto');
  const aba = estado.abaProjeto;
  const { largura: W, altura: H } = p.ajustes;
  el.innerHTML = `
    <div class="detalhe-topo">
      <button class="btn fantasma" id="pVoltar">← Projetos</button>
      <input id="pNome" value="${esc(p.nome)}" aria-label="Nome do projeto">
      <span class="status ${p.status}">${{ pronto: 'pronto', gerando: 'gerando…', erro: 'erro' }[p.status]}</span>
      <span class="mono">${W}×${H} · ${p.ajustes.duracao}s · ${esc(p.modelo)}</span>
      <span class="espaco"></span>
      <button class="btn mini perigo" id="pExcluir">Excluir</button>
    </div>
    <div class="detalhe">
      <div class="preview-caixa">
        <div class="preview-area" id="pvArea">
          ${p.versaoAtual ? `<iframe id="pvFrame" src="/p/${p.id}/?v=${p.versaoAtual}&t=${Date.now()}" width="${W}" height="${H}" allow="autoplay; fullscreen"></iframe>` : ''}
          <div class="overlay-gerando" id="ovGerando" ${p.status === 'gerando' ? '' : 'hidden'}>
            <div><div class="spinner"></div><b>O Claude está criando a animação</b>
            <p class="mono" id="ovMsg">Aguardando…</p>
            <button class="btn mini" id="pCancelar">Cancelar</button></div>
          </div>
          ${!p.versaoAtual && p.status === 'erro' ? `<div class="overlay-gerando"><div class="erro-caixa" style="max-width:560px">${esc(p.erro)}</div></div>` : ''}
        </div>
        <div class="preview-barra">
          <button class="btn mini" id="pReiniciar" ${p.versaoAtual ? '' : 'disabled'}>↻ Reiniciar</button>
          <button class="btn mini" id="pComSom" ${p.versaoAtual && (p.audio.voz.arquivo || p.audio.efeitos.arquivo) ? '' : 'disabled'} title="Reinicia a animação tocando a voz e os efeitos gerados">🔊 Assistir com som</button>
          <a class="btn mini" href="/p/${p.id}/" target="_blank" rel="noopener">Abrir em nova aba ↗</a>
          <span class="zoom-preview"><button class="btn mini" id="pMenor" title="Diminuir o vídeo (Ctrl + roda do mouse também)">－</button><button class="btn mini" id="pZoom" title="Voltar a caber na tela">100%</button><button class="btn mini" id="pMaior" title="Aumentar o vídeo (Ctrl + roda do mouse também)">＋</button></span>
          <button class="btn mini" id="pPainel" title="Esconder/mostrar o painel lateral">⇔ Painel</button>
          <button class="btn mini" id="pCheia" title="Tela cheia (Esc para sair)">⛶ Tela cheia</button>
          <span class="espaco"></span>
          <span class="mono">versão ${p.versaoAtual || '—'} de ${p.versoes.length}</span>
        </div>
      </div>
      <div class="divisor" id="pDivisor" title="Arraste para aumentar ou diminuir o vídeo · duplo clique volta ao padrão"></div>
      <div class="painel-lateral">
        <div class="painel-abas">
          ${[['refinar', 'Refinar'], ['som', 'Som'], ['render', 'Renderizar'], ['versoes', 'Versões'], ['codigo', 'Código'], ['prompt', 'Prompt']]
            .map(([k, v]) => `<button data-aba="${k}" class="${k === aba ? 'ativa' : ''}">${v}</button>`).join('')}
        </div>
        <div class="painel-corpo" id="pCorpo"></div>
      </div>
    </div>`;
  $('#pVoltar').onclick = () => fecharProjeto();
  $('#pNome').onchange = (e) => api(`/api/projetos/${p.id}`, { method: 'PATCH', corpo: { nome: e.target.value } });
  $('#pExcluir').onclick = async () => {
    if (!confirm(`Excluir o projeto "${p.nome}"? Os vídeos já renderizados continuam na Mídia.`)) return;
    await api(`/api/projetos/${p.id}`, { method: 'DELETE' });
    fecharProjeto();
  };
  $('#pCancelar') && ($('#pCancelar').onclick = () => api(`/api/projetos/${p.id}/cancelar`, { method: 'POST' }));
  $('#pComSom').onclick = () => assistirComSom(p);
  $('#pReiniciar').onclick = () => { pararSomPreview(); const f = $('#pvFrame'); if (f) f.src = f.src.replace(/&t=\d+/, '&t=' + Date.now()); };
  $$('.painel-abas button', el).forEach((b) => b.onclick = () => { estado.abaProjeto = b.dataset.aba; desenharDetalhe(p); });
  ligarTamanhoPreview(el);
  encaixarIframe();
  desenharAba(p);
}

// tamanho da tela do vídeo: divisor arrastável, botões +/−, esconder painel e tela cheia
const PAINEL_PADRAO = 420;
function lerLargPainel() { try { const v = +localStorage.getItem("larguraPainel"); return Number.isFinite(v) && v >= 0 && localStorage.getItem("larguraPainel") !== null ? v : PAINEL_PADRAO; } catch { return PAINEL_PADRAO; } }
function definirLargPainel(el, v) {
  const det = $(".detalhe", el);
  if (!det) return;
  const max = Math.max(300, det.clientWidth - 260);
  v = v <= 40 ? 0 : Math.round(Math.min(max, Math.max(280, v)));
  det.style.setProperty("--painel-largura", v + "px");
  det.classList.toggle("sem-painel", v === 0);
  try { localStorage.setItem("larguraPainel", v); } catch {}
  encaixarIframe();
}
function ligarTamanhoPreview(el) {
  definirLargPainel(el, lerLargPainel());
  const div = $("#pDivisor", el);
  const det = $(".detalhe", el);
  div.onpointerdown = (e) => {
    e.preventDefault();
    div.setPointerCapture(e.pointerId);
    det.classList.add("redimensionando");
    div.onpointermove = (m) => definirLargPainel(el, det.getBoundingClientRect().right - m.clientX);
    div.onpointerup = () => { div.onpointermove = null; det.classList.remove("redimensionando"); };
  };
  div.ondblclick = () => definirLargPainel(el, PAINEL_PADRAO);
  $("#pMaior").onclick = () => mudarZoom(zoomPreview + 0.1);
  $("#pMenor").onclick = () => mudarZoom(zoomPreview - 0.1);
  $("#pZoom").onclick = () => mudarZoom(1);
  $("#pvArea", el).addEventListener("wheel", (e) => { if (!e.ctrlKey) return; e.preventDefault(); mudarZoom(zoomPreview * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
  $("#pPainel").onclick = () => {
    const atual = lerLargPainel();
    if (atual) { try { localStorage.setItem("larguraPainelAntes", atual); } catch {} definirLargPainel(el, 0); }
    else { let antes = PAINEL_PADRAO; try { antes = +localStorage.getItem("larguraPainelAntes") || PAINEL_PADRAO; } catch {} definirLargPainel(el, antes); }
  };
  $("#pCheia").onclick = () => {
    const cx = $(".preview-caixa", el);
    if (document.fullscreenElement) document.exitFullscreen();
    else cx.requestFullscreen?.().catch(() => toast("O navegador não permitiu a tela cheia.", "erro"));
  };
}
document.addEventListener("fullscreenchange", () => setTimeout(encaixarIframe, 60));

let zoomPreview = (() => { try { return +localStorage.getItem("zoomPreview") || 1; } catch { return 1; } })();
function mudarZoom(v) {
  zoomPreview = Math.round(Math.min(3, Math.max(0.3, v)) * 100) / 100;
  try { localStorage.setItem("zoomPreview", zoomPreview); } catch {}
  encaixarIframe();
}
function encaixarIframe() {
  const area = $('#pvArea');
  const f = $('#pvFrame');
  if (!area || !f) return;
  const W = +f.width;
  const H = +f.height;
  const caber = Math.min((area.clientWidth - 24) / W, (area.clientHeight - 24) / H);
  const e = caber * zoomPreview;
  const sw = W * e, sh = H * e;
  // centraliza quando cabe; com zoom maior, a área ganha rolagem
  f.style.transformOrigin = "0 0";
  f.style.transform = `scale(${e})`;
  f.style.left = Math.max(12, (area.clientWidth - sw) / 2) + "px";
  f.style.top = Math.max(12, (area.clientHeight - sh) / 2) + "px";
  let esp = $("#pvEspaco");
  if (!esp) { esp = document.createElement("div"); esp.id = "pvEspaco"; area.appendChild(esp); }
  esp.style.width = (sw + 24) + "px"; esp.style.height = (sh + 24) + "px";
  const z = $("#pZoom"); if (z) z.textContent = Math.round(zoomPreview * 100) + "%";
}
window.addEventListener('resize', () => { encaixarIframe(); ajustarPalco(); });

const SUGESTOES = [
  'Deixe o ritmo mais rápido e energético',
  'Aumente o tamanho dos textos para leitura no celular',
  'Troque a paleta para preto, laranja e branco',
  'Adicione um final com o logo/nome centralizado por 2 segundos',
  'Deixe o fundo mais rico, com profundidade e textura',
  'Mais impacto nos primeiros 2 segundos (gancho)',
];

async function desenharAba(p) {
  const c = $('#pCorpo');
  const aba = estado.abaProjeto;
  const opcoesModelo = estado.modelosClaude.map((x) => `<option value="${x.id}" ${x.id === p.modelo ? 'selected' : ''}>${esc(x.nome)}</option>`).join('');

  if (aba === 'refinar') {
    c.innerHTML = `
      ${p.erro ? `<div class="erro-caixa">Última tentativa falhou: ${esc(p.erro)}</div>` : ''}
      <label>O que mudar nesta animação?
        <textarea id="rInstr" rows="5" placeholder="Ex.: troque o texto final pelo nome da minha marca, deixe as partículas douradas e acelere a entrada"></textarea>
      </label>
      <div class="sugestoes">${SUGESTOES.map((s) => `<button>${esc(s)}</button>`).join('')}</div>
      <label>Modelo<select id="rModelo">${opcoesModelo}</select></label>
      <button class="btn primario" id="rEnviar" ${p.status === 'gerando' ? 'disabled' : ''}>✦ Refinar com Claude</button>
      <p class="ajuda">Cada refinamento vira uma nova versão — as anteriores ficam salvas na aba Versões.</p>`;
    $$('.sugestoes button', c).forEach((b) => b.onclick = () => {
      const t = $('#rInstr');
      t.value = (t.value ? t.value.trim() + '\n' : '') + b.textContent;
    });
    $('#rEnviar').onclick = async () => {
      const instrucao = $('#rInstr').value.trim();
      if (!instrucao) return toast('Escreva o que mudar.', 'erro');
      try {
        await api(`/api/projetos/${p.id}/refinar`, { corpo: { instrucao, modelo: $('#rModelo').value } });
        renderizarDetalhe(true);
      } catch (e) { toast(e.message, 'erro'); }
    };
  }

  if (aba === 'som') return desenharAbaSom(p, c);

  if (aba === 'render') {
    const { largura: W, altura: H, duracao } = p.ajustes;
    const midias = await api('/api/midia');
    const meus = midias.filter((m) => m.projetoId === p.id);
    c.innerHTML = `
      <label>Resolução
        <select id="vRes">
          <option value="1">${W}×${H} (cheia)</option>
          <option value="0.6667">${Math.round(W * 2 / 3 / 2) * 2}×${Math.round(H * 2 / 3 / 2) * 2} (mais rápido)</option>
          <option value="0.5">${Math.round(W / 4) * 2}×${Math.round(H / 4) * 2} (rascunho)</option>
        </select>
      </label>
      <div class="linha">
        <label>FPS<select id="vFps"><option>24</option><option selected>30</option><option>60</option></select></label>
        <label>Duração (s)<input type="number" id="vDur" min="1" max="300" step="0.5" value="${duracao}"></label>
        <label>Pular início (s)<input type="number" id="vPular" min="0" step="0.5" value="0"></label>
      </div>
      ${resumoAudioRender(p.audio)}
      <button class="btn primario" id="vRender" ${p.versaoAtual ? '' : 'disabled'}>● Renderizar MP4 (versão ${p.versaoAtual || '—'})</button>
      <div id="vProg" hidden><div class="barra-prog"><i></i></div><p class="mono" id="vMsg"></p></div>
      <p class="ajuda">O render roda num navegador invisível com relógio virtual: cada quadro sai perfeito, mesmo que o PC seja lento. Animações pesadas em 3D podem levar alguns minutos.</p>
      <h2 style="margin-top:6px">Vídeos deste projeto</h2>
      <div id="vLista" style="display:grid;gap:8px">${meus.length ? meus.map(itemRender).join('') : '<p class="ajuda">Nenhum render ainda.</p>'}</div>`;
    $('#vRender').onclick = async () => {
      const k = +$('#vRes').value;
      $('#vRender').disabled = true;
      $('#vProg').hidden = false;
      try {
        const { job } = await api(`/api/projetos/${p.id}/render`, {
          corpo: { largura: W * k, altura: H * k, fps: +$('#vFps').value, duracao: +$('#vDur').value, pularInicio: +$('#vPular').value, versao: p.versaoAtual, comAudio: $('#vComAudio')?.checked ?? false },
        });
        const fim = await acompanharJob(job.id, (j) => {
          const prog = $('#vProg i');
          if (prog) prog.style.width = `${Math.round((j.progresso || 0) * 100)}%`;
          if ($('#vMsg')) $('#vMsg').textContent = j.erro || j.ultima || '';
        });
        if (fim.status === 'ok') { toast('Vídeo renderizado! Já está na Mídia do editor.', 'ok'); if (estado.projetoAberto === p.id && estado.abaProjeto === 'render') desenharAba(p); }
        else toast('Render falhou: ' + fim.erro, 'erro');
      } catch (e) { toast(e.message, 'erro'); }
      if ($('#vRender')) $('#vRender').disabled = false;
    };
    ligarItensRender(c);
  }

  if (aba === 'versoes') {
    c.innerHTML = p.versoes.length ? [...p.versoes].reverse().map((v) => `
      <div class="versao ${v.n === p.versaoAtual ? 'atual' : ''}">
        <b>v${v.n}</b>
        <div><span>${{ gerado: 'Gerada do prompt', refino: 'Refinamento', manual: 'Edição manual' }[v.origem]}</span>
          <small>${quando(v.criado)}${v.instrucao ? ' · ' + esc(v.instrucao.slice(0, 90)) : ''}</small></div>
        <a class="btn mini" href="/p/${p.id}/?v=${v.n}" target="_blank">ver</a>
        ${v.n === p.versaoAtual ? '<span class="mono">atual</span>' : `<button class="btn mini" data-usar="${v.n}">usar</button>`}
      </div>`).join('') : '<p class="ajuda">Ainda não há versões.</p>';
    $$('[data-usar]', c).forEach((b) => b.onclick = async () => {
      await api(`/api/projetos/${p.id}`, { method: 'PATCH', corpo: { versaoAtual: +b.dataset.usar } });
      renderizarDetalhe(true);
    });
  }

  if (aba === 'codigo') {
    c.innerHTML = `<p class="ajuda" style="margin:0">Edite o HTML da versão atual. Salvar cria uma nova versão.</p>
      <textarea class="codigo" id="cCodigo" spellcheck="false">carregando…</textarea>
      <button class="btn primario" id="cSalvar" disabled>Salvar como nova versão</button>`;
    if (p.versaoAtual) {
      $('#cCodigo').value = await api(`/api/projetos/${p.id}/html?v=${p.versaoAtual}`);
      $('#cSalvar').disabled = false;
    } else $('#cCodigo').value = '';
    $('#cSalvar').onclick = async () => {
      try {
        await api(`/api/projetos/${p.id}/html`, { method: 'PUT', corpo: { html: $('#cCodigo').value } });
        toast('Nova versão salva.', 'ok');
        renderizarDetalhe(true);
      } catch (e) { toast(e.message, 'erro'); }
    };
  }

  if (aba === 'prompt') {
    const a = p.ajustes;
    c.innerHTML = `
      ${p.autor ? `<p class="ajuda" style="margin:0">Baseado no modelo de <b>@${esc(p.autor)}</b></p>` : ''}
      <div class="prompt-original">${esc(p.prompt)}</div>
      ${p.imagens?.length ? `<div class="lista-imagens">${p.imagens.map((im) => `<div class="img-item"><img src="/p/${p.id}/assets/${encodeURIComponent(im.arquivo)}" alt=""><div><b>${im.papel === 'referencia' ? 'Referência' : 'Elemento'}</b><br><small>${esc(im.descricao || im.arquivo)}</small></div></div>`).join('')}</div>` : ''}
      <div class="mono" style="white-space:pre-wrap">${esc([
        `Formato: ${a.largura}×${a.altura} (${a.formatoNome || ''})`, `Duração: ${a.duracao}s`,
        a.idioma && `Idioma: ${a.idioma}`, a.tema && `Tema: ${a.tema}`, a.textos && `Textos: ${a.textos}`,
        a.cores && `Paleta: ${a.cores}`, a.extra && `Extra: ${a.extra}`,
      ].filter(Boolean).join('\n'))}</div>
      <label>Modelo<select id="gModelo">${opcoesModelo}</select></label>
      <button class="btn" id="gRegerar" ${p.status === 'gerando' ? 'disabled' : ''}>↻ Gerar de novo do zero (nova versão)</button>`;
    $('#gRegerar').onclick = async () => {
      try { await api(`/api/projetos/${p.id}/regerar`, { corpo: { modelo: $('#gModelo').value } }); renderizarDetalhe(true); }
      catch (e) { toast(e.message, 'erro'); }
    };
  }
}

// ===================================================================== SOM (voz + efeitos)
function resumoAudioRender(a) {
  const tem = [a.voz.ativo && a.voz.arquivo && 'voz', a.efeitos.ativo && a.efeitos.arquivo && 'efeitos'].filter(Boolean);
  if (!tem.length) return '<p class="ajuda" style="margin:0">Sem áudio: gere voz e efeitos na aba <b>Som</b> para o MP4 já sair sonorizado.</p>';
  const pend = (a.voz.ativo && a.voz.pendente) || (a.efeitos.ativo && a.efeitos.pendente);
  return `<label class="check"><input type="checkbox" id="vComAudio" checked> incluir ${tem.join(' e ')} da aba Som</label>
    ${pend ? '<p class="ajuda" style="margin:0;color:var(--aviso)">Há alterações no Som ainda não geradas; o render usa a última versão gerada.</p>' : ''}`;
}

const somPreview = { voz: new Audio(), efeitos: new Audio() };
function pararSomPreview() { for (const a of Object.values(somPreview)) { a.pause(); a.currentTime = 0; } }
function assistirComSom(p) {
  const f = $('#pvFrame');
  if (!f) return;
  pararSomPreview();
  const faixas = ['voz', 'efeitos'].filter((k) => p.audio[k].ativo && p.audio[k].arquivo);
  for (const k of faixas) {
    somPreview[k].src = `/p/${p.id}/audio/${p.audio[k].arquivo}`;
    somPreview[k].volume = Math.min(1, p.audio[k].volume);
    somPreview[k].load();
  }
  f.onload = () => { for (const k of faixas) somPreview[k].play().catch(() => {}); f.onload = null; };
  f.src = f.src.replace(/&t=\d+/, '&t=' + Date.now());
}

const ESTILOS_SOM = [
  ['🎬 Cinematográfico', 'cinematográfico de trailer: impactos graves, braams, risers, whooshes cheios, cauda longa de reverb'],
  ['💻 Tech / interface', 'tecnológico premium: UI limpo, glitches sutis, whooshes digitais, pulsos eletrônicos, brilho'],
  ['💎 Luxo / elegante', 'luxo e elegância: sons refinados, brilho cristalino, impactos suaves e profundos, ar e espaço'],
  ['⚡ Energia / esporte', 'energia e esporte: batidas secas, whooshes rápidos, impactos de força, adrenalina'],
  ['🌿 Orgânico', 'orgânico e natural: foley realista, materiais naturais, texturas de ar, toque humano'],
  ['🌑 Suspense / dark', 'suspense sombrio: drones graves, tensão crescente, impactos metálicos, silêncios'],
  ['🎈 Pop / divertido', 'pop divertido: pops, bloops, swishes coloridos e brincalhões, ritmo leve'],
  ['🕹 Game / arcade', 'game moderno: power-ups, moedas, transições de fase, impactos estilizados'],
];
const cacheVozes = {};
async function vozesDe(provedor) {
  if (!cacheVozes[provedor]) cacheVozes[provedor] = api(`/api/audio/vozes?provedor=${provedor}`).catch((e) => { delete cacheVozes[provedor]; throw e; });
  return cacheVozes[provedor];
}
let cacheProvedores;
let cacheBiblioteca = null;

async function desenharAbaSom(p, c) {
  const a = JSON.parse(JSON.stringify(p.audio));
  const config = await api('/api/config');
  cacheProvedores = cacheProvedores || await api('/api/audio/provedores');
  if (a.efeitos.motor === 'biblioteca' || cacheBiblioteca === null) cacheBiblioteca = await api('/api/audio/biblioteca');
  const eleven = config.elevenlabs.configurado;
  const opcoesModelo = estado.modelosClaude.map((x) => `<option value="${x.id}" ${x.id === 'claude-sonnet-5-5' ? 'selected' : ''}>${esc(x.nome)}</option>`).join('');
  const urlAudio = (arq) => `/p/${p.id}/audio/${arq}?t=${Date.now()}`;
  setTimeout(() => { const b = $("#sEstudioVoz"); if (b) b.onclick = () => { vz.id = p.id; vz.l = null; try { localStorage.setItem("vozProjeto", p.id); } catch {} irPara("voz"); }; });

  c.innerHTML = `
    <div id="sJob" hidden><div class="barra-prog"><i></i></div><p class="mono" id="sJobMsg"></p></div>
    <button class="btn" id="sEstudioVoz" title="Roteiro sobre o vídeo + voz inteira na ElevenLabs, com takes">🎙 Abrir o Estúdio de voz (melhor qualidade)</button>
    <label>Claude para roteiro e efeitos<select id="sModelo">${opcoesModelo}</select></label>

    <h2 style="margin:6px 0 0">🎙 Voz / locução</h2>
    <div class="linha">
      <label class="check"><input type="checkbox" id="vzAtivo" ${a.voz.ativo ? 'checked' : ''}> usar no vídeo</label>
      <label>Volume<input type="range" id="vzVol" min="0" max="1.5" step="0.05" value="${a.voz.volume}"></label>
    </div>
    <label>Motor de voz
      <select id="vzProv">${cacheProvedores.map((x) => `<option value="${x.id}" ${x.id === a.voz.provedor ? 'selected' : ''} ${x.id === 'elevenlabs' && !eleven ? 'disabled' : ''}>${esc(x.nome)}${x.id === 'elevenlabs' && !eleven ? ' — configure a chave em ⚙' : ''}</option>`).join('')}</select>
    </label>
    <div id="vzTts" class="campos" ${a.voz.provedor === 'arquivo' ? 'hidden' : ''}>
      <input type="search" id="vzBusca" placeholder="Buscar voz pelo nome…" ${a.voz.provedor === 'elevenlabs' ? '' : 'hidden'}>
      <div class="linha">
        <label style="flex:2">Voz<select id="vzVoz"><option>carregando…</option></select></label>
        <button class="btn mini" id="vzAmostra" style="flex:none;align-self:flex-end;margin-bottom:4px" title="Ouvir amostra" hidden>▶</button>
      </div>
      <div id="vzElevenCard" class="voz-card" hidden>
        <div><small>Voz ElevenLabs escolhida</small><b id="vzElevenNome">—</b></div>
        <button type="button" class="btn primario" id="vzAbrirBiblioteca">🎧 Escolher voz na biblioteca</button>
      </div>
      <p class="ajuda" id="vzAvisoPerm" style="margin:0" hidden></p>
      <div class="linha" id="vzModeloLinha" ${a.voz.provedor === 'elevenlabs' ? '' : 'hidden'}>
        <label>Modelo ElevenLabs<select id="vzModelo"><option value="">Eleven v4 (padrão)</option></select></label>
        <label>Interpretação<select id="vzInterp">
          <option value="estavel" ${a.voz.interpretacao === 'estavel' ? 'selected' : ''}>Estável (locutor)</option>
          <option value="natural" ${(a.voz.interpretacao || 'natural') === 'natural' ? 'selected' : ''}>Natural</option>
          <option value="expressiva" ${a.voz.interpretacao === 'expressiva' ? 'selected' : ''}>Expressiva (anúncio)</option>
        </select></label>
      </div>
      <div class="linha" style="align-items:center">
        <button type="button" class="btn" id="vzTestar" style="flex:none">🔊 Testar a voz</button>
        <span class="ajuda" id="vzTestarMsg" style="margin:0">Ouça uma frase antes de gerar tudo.</span>
      </div>
      <label>Velocidade: <span id="vzVelTxt">${a.voz.velocidade.toFixed(2)}×</span><input type="range" id="vzVel" min="0.7" max="1.3" step="0.05" value="${a.voz.velocidade}"></label>
      <label>Tom da locução<input type="text" id="vzTom" value="${esc(a.voz.tom)}" placeholder="Ex.: energético, confiante, de anúncio fitness"></label>
      <label>Instruções para o roteiro (opcional)<input type="text" id="vzInstr" value="${esc(a.voz.instrucoes)}" placeholder="Ex.: termine com 'Compre agora no link'"></label>
      <button class="btn" id="vzRoteiro">✦ Escrever roteiro com Claude</button>
      <div id="vzFalas" style="display:grid;gap:6px"></div>
      <button class="btn mini fantasma" id="vzAdd" style="justify-self:start">＋ fala</button>
      <button class="btn primario" id="vzGerar">🎙 Gerar voz</button>
    </div>
    <div id="vzGravado" class="campos" ${a.voz.provedor === 'arquivo' ? '' : 'hidden'}>
      <label class="btn" style="justify-content:center">⬆ ${a.voz.gravacao ? 'Trocar' : 'Enviar'} meu áudio (MP3, WAV, M4A ou vídeo)
        <input type="file" id="gvArquivo" accept="audio/*,video/*" hidden></label>
      ${a.voz.gravacao ? `
        <p class="ajuda" style="margin:0">Arquivo: <b>${esc(a.voz.gravacao.nomeOriginal || a.voz.gravacao.arquivo)}</b> · ${a.voz.gravacao.duracao.toFixed(1)}s ·
          vídeo atual: ${p.ajustes.duracao}s</p>
        <label>Atraso do áudio no vídeo (s) — positivo empurra a fala para depois; negativo corta o começo do áudio
          <input type="number" id="gvDesl" step="0.05" value="${a.voz.gravacao.deslocamento || 0}"></label>
        ${a.voz.gravacao.transcricao ? `
          <b style="font-size:12px;color:var(--texto-2)">O QUE FOI FALADO (tempo no vídeo)</b>
          <div class="transcricao">${a.voz.gravacao.transcricao.frases.map((f) => `<div><span class="mono">${(f.inicio + (a.voz.gravacao.deslocamento || 0)).toFixed(2)}s</span> ${esc(f.texto)}</div>`).join('')}</div>
          <label class="check"><input type="checkbox" id="gvDur" checked> ajustar a duração do vídeo ao áudio</label>
          <button class="btn primario" id="gvSinc" ${p.status === 'gerando' ? 'disabled' : ''}>✦ Sincronizar a animação com o meu áudio (Claude)</button>
          <p class="ajuda" style="margin:0">O Claude reescreve os tempos da animação para cada texto e cena entrar quando você fala aquilo. Vira uma versão nova; dá para voltar na aba Versões.</p>`
        : '<p class="ajuda" style="margin:0">Sem transcrição ainda.</p>'}
        <button class="btn mini fantasma" id="gvRetranscrever" style="justify-self:start">↻ Transcrever de novo</button>` : `
        <p class="ajuda" style="margin:0">Envie a locução que você gravou. O estúdio transcreve offline (Whisper) com o tempo de cada palavra e o Claude sincroniza a animação com a sua fala. Na primeira vez baixa o modelo de transcrição (~480 MB).</p>`}
    </div>
    <div id="vzStatus"></div>

    <h2 style="margin:14px 0 0">💥 Sonoplastia (efeitos sonoros)</h2>
    <div class="linha">
      <label class="check"><input type="checkbox" id="efAtivo" ${a.efeitos.ativo ? 'checked' : ''}> usar no vídeo</label>
      <label>Volume<input type="range" id="efVol" min="0" max="1.5" step="0.05" value="${a.efeitos.volume}"></label>
    </div>
    <label>De onde vêm os sons
      <select id="efMotor">
        <option value="elevenlabs" ${eleven ? '' : 'disabled'}>ElevenLabs Sound Effects — qualidade de cinema (usa créditos)${eleven ? '' : ' — configure em ⚙'}</option>
        <option value="codigo">Sintetizados pela IA em código (grátis)</option>
        <option value="biblioteca">Minha biblioteca de sons (${cacheBiblioteca.length})</option>
      </select>
    </label>
    <div>
      <small class="rotulo-mini">Estilo sonoro</small>
      <div class="chips pequenos" id="efEstilos">${ESTILOS_SOM.map(([k, v]) => `<button type="button" data-estilo="${esc(v)}" class="${a.efeitos.estilo === v ? 'ativa' : ''}">${k}</button>`).join('')}</div>
      <input type="text" id="efEstilo" value="${esc(a.efeitos.estilo)}" placeholder="ou descreva: ex. trailer épico com graves profundos e risers" style="margin-top:6px">
    </div>
    <div class="linha" style="align-items:end">
      <div style="flex:none">
        <small class="rotulo-mini">Intensidade</small>
        <div class="chips pequenos" id="efIntensidade">${[['sutil', 'Sutil'], ['equilibrado', 'Equilibrado'], ['intenso', 'Intenso / trailer']].map(([k, v]) => `<button type="button" data-int="${k}" class="${(a.efeitos.intensidade || 'equilibrado') === k ? 'ativa' : ''}">${v}</button>`).join('')}</div>
      </div>
      <label class="check"><input type="checkbox" id="efAmbiente" ${a.efeitos.comAmbiente !== false ? 'checked' : ''}> ambiência contínua (imersão)</label>
    </div>
    <label class="check" id="efTrilhaLinha"><input type="checkbox" id="efTrilha" ${a.efeitos.comTrilha ? 'checked' : ''}> incluir batida/trilha de fundo sintetizada</label>
    <div id="efBib" class="ajuda" style="margin:0"></div>
    <button class="btn primario" id="efMapa">👁 Assistir ao vídeo e desenhar o som (IA)</button>
    <p class="ajuda" style="margin:-4px 0 0">A IA assiste ao vídeo (quadros, cortes, movimento, flashes e a sua locução) e planeja cada som com intenção: impactos no quadro, risers que terminam na revelação, camadas, pan, reverb e silêncios.</p>
    <div id="efPlano"></div>
    <div id="efLista" style="display:grid;gap:8px"></div>
    <button class="btn mini fantasma" id="efAdd" style="justify-self:start">＋ som manual</button>
    <button class="btn primario" id="efGerar">🔊 Gerar sonoplastia</button>
    <div id="efStatus"></div>`;

  $('#efMotor').value = a.efeitos.motor;

  // ---------- salvar alterações (com debounce)
  let tSalvar;
  const salvar = (imediato) => new Promise((ok) => {
    clearTimeout(tSalvar);
    tSalvar = setTimeout(async () => {
      try {
        const r = await api(`/api/projetos/${p.id}/audio`, { method: 'PUT', corpo: { voz: a.voz, efeitos: a.efeitos } });
        a.voz.pendente = r.voz.pendente; a.efeitos.pendente = r.efeitos.pendente;
        p.audio = r;
        statusFaixas();
      } catch (e) { toast(e.message, 'erro'); }
      ok();
    }, imediato ? 0 : 400);
  });

  function assistirNoTopo() {
    p.audio = { ...p.audio, voz: { ...p.audio.voz, ...a.voz }, efeitos: { ...p.audio.efeitos, ...a.efeitos } };
    document.querySelector('.preview-caixa')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelector('.preview-caixa')?.classList.add('destaque');
    setTimeout(() => document.querySelector('.preview-caixa')?.classList.remove('destaque'), 1600);
    assistirComSom(p);
  }
  function statusFaixas() {
    const linha = (t, rot) => {
      if (!t.arquivo) return `<p class="ajuda" style="margin:0">${rot} ainda não gerada.</p>`;
      return `${t.pendente ? `<p class="ajuda" style="margin:0;color:var(--aviso)">Alterações não geradas: clique em gerar de novo.</p>` : ''}
        <audio controls src="${urlAudio(t.arquivo)}" style="width:100%;height:36px"></audio>`;
    };
    $('#vzStatus').innerHTML = linha(a.voz, 'Voz');
    $('#efStatus').innerHTML = linha(a.efeitos, 'Faixa de efeitos');
    // assistir ao vídeo com tudo junto, direto daqui
    if (a.voz.arquivo || a.efeitos.arquivo) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn primario btn-assistir';
      b.textContent = '▶ Assistir ao vídeo com voz + efeitos';
      b.onclick = () => assistirNoTopo();
      $('#efStatus').append(b);
    }
    $('#pComSom') && ($('#pComSom').disabled = !(a.voz.arquivo || a.efeitos.arquivo));
  }

  // ---------- voz
  async function carregarVozes() {
    const sel = $('#vzVoz');
    const eleven = a.voz.provedor === 'elevenlabs';
    $('#vzTts').hidden = a.voz.provedor === 'arquivo';
    $('#vzGravado').hidden = a.voz.provedor !== 'arquivo';
    if (a.voz.provedor === 'arquivo') return;
    sel.innerHTML = '<option>carregando…</option>';
    $('#vzModeloLinha').hidden = !eleven;
    $('#vzBusca').hidden = !eleven;
    try {
      const vozes = [...await vozesDe(a.voz.provedor)];
      if (!vozes.some((v) => v.id === a.voz.voz)) {
        // ID colado manualmente (ElevenLabs) é mantido; nos outros motores volta para a primeira voz
        if (eleven && a.voz.voz) vozes.unshift({ id: a.voz.voz, nome: a.voz.vozNome || `ID personalizado: ${a.voz.voz}`, grupo: 'Escolhida' });
        else { a.voz.voz = vozes[0]?.id || ''; salvar(); }
      }
      const semPermissao = vozes.some((v) => /permissão|sotaque estrangeiro/.test(v.grupo || ''));
      $('#vzAvisoPerm').hidden = !semPermissao;
      $('#vzAvisoPerm').innerHTML = '⚠ As vozes padrão da ElevenLabs são <b>nativas em inglês</b> e falam português com sotaque estrangeiro. Para voz brasileira de verdade, ative a permissão <b>Voices (Read e Write)</b> na sua chave (elevenlabs.io → Settings → API Keys) e escolha uma voz em <b>🎧 Escolher voz na biblioteca → Explorar</b> (sotaque Brasileiro). Ou use o motor <b>Piper</b> (grátis, pt-BR nativo).';
      $('#vzAvisoPerm').classList.toggle('aviso', semPermissao);
      // agrupa (Minhas vozes / Biblioteca pt-BR) e filtra pela busca, mostrando o nome exato do site
      const desenhar = () => {
        const termo = normalizar($('#vzBusca').value);
        const visiveis = vozes.filter((v) => !termo || v.id === a.voz.voz || normalizar(`${v.nome} ${v.info || ''}`).includes(termo));
        const grupos = new Map();
        for (const v of visiveis) {
          const g = v.grupo || '';
          if (!grupos.has(g)) grupos.set(g, []);
          grupos.get(g).push(v);
        }
        const opcao = (v) => `<option value="${esc(v.id)}" ${v.id === a.voz.voz ? 'selected' : ''}>${esc(v.nome)}${v.info ? ` — ${esc(v.info)}` : ''}</option>`;
        sel.innerHTML = [...grupos].map(([g, vs]) => (g ? `<optgroup label="${esc(g)} (${vs.length})">${vs.map(opcao).join('')}</optgroup>` : vs.map(opcao).join(''))).join('')
          + (eleven ? '<option value="__outro">✎ Colar o ID de outra voz da minha conta…</option>' : '');
      };
      desenhar();
      $('#vzBusca').oninput = desenhar;
      $('#vzElevenCard').hidden = !eleven;
      if (eleven) {
        $('#vzElevenNome').textContent = a.voz.vozNome || vozes.find((v) => v.id === a.voz.voz)?.nome || a.voz.voz || '—';
        $('#vzAbrirBiblioteca').onclick = () => abrirSeletorVozes(a.voz.voz, (v) => {
          a.voz.voz = v.id;
          a.voz.vozNome = v.nome;
          salvar();
          carregarVozes();
        });
      }
      const atual = () => vozes.find((v) => v.id === sel.value);
      $('#vzAmostra').hidden = !atual()?.preview;
      $('#vzAmostra').onclick = () => { const v = atual(); if (v?.preview) new Audio(v.preview).play(); };
      sel.onchange = () => {
        if (sel.value === '__outro') {
          const id = (prompt('Cole o Voice ID (ElevenLabs → Voices → clique na voz → “ID”):') || '').trim();
          if (id) { a.voz.voz = id; salvar(); carregarVozes(); } else sel.value = a.voz.voz;
          return;
        }
        a.voz.voz = sel.value; a.voz.vozNome = atual()?.nome || ''; $('#vzAmostra').hidden = !atual()?.preview; salvar();
        if (eleven) $('#vzElevenNome').textContent = a.voz.vozNome;
      };
      if (a.voz.provedor === 'elevenlabs' && $('#vzModelo').options.length < 2) {
        const modelos = await api('/api/audio/modelos-eleven');
        $('#vzModelo').innerHTML = '<option value="">Eleven v4 (padrão)</option>'
          + modelos.map((m) => `<option value="${m.id}" ${m.id === a.voz.modelo ? 'selected' : ''}>${esc(m.nome)}</option>`).join('');
      }
    } catch (e) { sel.innerHTML = `<option>${esc(e.message)}</option>`; }
  }
  $('#vzProv').onchange = (e) => { a.voz.provedor = e.target.value; a.voz.voz = ''; salvar(); carregarVozes(); };
  $('#vzModelo').onchange = (e) => { a.voz.modelo = e.target.value; salvar(); };
  $('#vzInterp').onchange = (e) => { a.voz.interpretacao = e.target.value; salvar(); };
  $('#vzTestar').onclick = async () => {
    await salvar(true);
    const b = $('#vzTestar');
    b.disabled = true;
    $('#vzTestarMsg').textContent = 'Gerando a amostra…';
    try {
      const r = await api(`/api/projetos/${p.id}/audio/testar-voz`, { corpo: {} });
      $('#vzTestarMsg').textContent = `“${r.texto}”`;
      audioAmostra.src = r.url + '?t=' + Date.now();
      audioAmostra.play().catch(() => {});
    } catch (e) { $('#vzTestarMsg').textContent = e.message; }
    b.disabled = false;
  };
  $('#vzVel').oninput = (e) => { a.voz.velocidade = +e.target.value; $('#vzVelTxt').textContent = a.voz.velocidade.toFixed(2) + '×'; salvar(); };
  $('#vzVol').oninput = (e) => { a.voz.volume = +e.target.value; salvar(); };
  $('#vzAtivo').onchange = (e) => { a.voz.ativo = e.target.checked; salvar(); };
  $('#vzTom').onchange = (e) => { a.voz.tom = e.target.value; salvar(); };
  $('#vzInstr').onchange = (e) => { a.voz.instrucoes = e.target.value; salvar(); };

  // ---------- meu áudio gravado
  async function acompanharAudio(job, rotulo) {
    $$('#pCorpo button.btn').forEach((b) => { b.disabled = true; });
    $('#sJob').hidden = false;
    const fim = await acompanharJob(job.id, (j) => {
      if (!$('#sJob')) return;
      $('#sJob i').style.width = `${Math.round((j.progresso || 0.05) * 100)}%`;
      $('#sJobMsg').textContent = j.erro || j.ultima || '';
    });
    toast(fim.status === 'ok' ? `${rotulo}: pronto!` : `${rotulo} falhou: ${fim.erro}`, fim.status === 'ok' ? 'ok' : 'erro');
    if (estado.projetoAberto === p.id && estado.abaProjeto === 'som') desenharAbaSom(await api(`/api/projetos/${p.id}`), $('#pCorpo'));
  }
  $('#gvArquivo').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $('#sJob').hidden = false;
    $('#sJobMsg').textContent = `Enviando ${f.name}…`;
    try {
      const r = await fetch(`/api/projetos/${p.id}/audio/gravacao?nome=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      acompanharAudio(d.job, 'Transcrição');
    } catch (err) { toast(err.message, 'erro'); }
  };
  if ($('#gvDesl')) $('#gvDesl').onchange = async (e) => {
    try {
      await api(`/api/projetos/${p.id}/audio/gravacao`, { method: 'PATCH', corpo: { deslocamento: +e.target.value || 0 } });
      desenharAbaSom(await api(`/api/projetos/${p.id}`), $('#pCorpo'));
    } catch (err) { toast(err.message, 'erro'); }
  };
  if ($('#gvRetranscrever')) $('#gvRetranscrever').onclick = async () => {
    try { acompanharAudio((await api(`/api/projetos/${p.id}/audio/transcrever`, { corpo: {} })).job, 'Transcrição'); }
    catch (err) { toast(err.message, 'erro'); }
  };
  if ($('#gvSinc')) $('#gvSinc').onclick = async () => {
    try {
      await api(`/api/projetos/${p.id}/audio/sincronizar`, { corpo: { modelo: $('#sModelo').value, ajustarDuracao: $('#gvDur').checked } });
      toast('O Claude está ressincronizando a animação com o seu áudio…', 'ok');
      renderizarDetalhe(true);
    } catch (err) { toast(err.message, 'erro'); }
  };

  function desenharFalas() {
    const fs = a.voz.falas;
    $('#vzFalas').innerHTML = fs.length ? fs.map((f, i) => {
      const prox = fs[i + 1]?.inicio ?? p.ajustes.duracao;
      // depois de gerar, o organizador garante que nada sobrepõe; aqui só mostramos o que ele fez
      const fim = f.duracao ? (f.inicioReal ?? f.inicio) + (f.duracaoReal ?? f.duracao) : null;
      const estoura = fim && f.inicioReal == null && fim > prox + 0.05;
      const janela = Math.max(0.3, (fs[i + 1]?.inicio ?? p.ajustes.duracao) - f.inicio - 0.25);
      const maxPal = Math.max(2, Math.floor(janela * 2.2 * (a.voz.velocidade || 1)));
      const nPal = f.texto.split(/\s+/).filter(Boolean).length;
      const ajuste = [f.tempo > 1.005 ? `⏩ ${f.tempo.toFixed(2)}×` : '', f.inicioReal != null && f.inicioReal > f.inicio + 0.01 ? `↦ ${f.inicioReal.toFixed(1)}s` : ''].filter(Boolean).join(' ');
      return `<div class="linha-fala" data-i="${i}">
        <input type="number" step="0.1" min="0" value="${f.inicio}" data-campo="inicio" title="Começa em (s)">
        <textarea rows="2" data-campo="texto">${esc(f.texto)}</textarea>
        <div class="fala-acoes">
          ${f.duracao ? `<small class="mono" style="color:${estoura ? 'var(--erro)' : 'var(--texto-3)'}" title="${estoura ? 'Fala maior que a janela — o organizador vai acelerar um pouco ou adiar a próxima' : 'Duração falada'}">${(f.duracaoReal ?? f.duracao).toFixed(1)}s${estoura ? ' ⚠' : ''}</small>` : ''}
          <small class="mono" style="color:${nPal > maxPal ? 'var(--erro)' : 'var(--texto-3)'}" title="Palavras desta fala / máximo que cabe no tempo até a próxima fala">${nPal}/${maxPal} pal.</small>
          ${ajuste ? `<small class="mono" style="color:var(--aviso)" title="Ajuste automático para não sobrepor: ⏩ acelerada (tom mantido) · ↦ entrou um pouco depois">${ajuste}</small>` : ''}
          ${f.arquivo ? `<button class="btn mini" data-ouvir="${f.arquivo}" title="Ouvir">▶</button>` : ''}
          <button class="btn mini perigo" data-rem title="Remover">✕</button>
        </div>
      </div>`;
    }).join('') : '<p class="ajuda" style="margin:0">Nenhuma fala. Peça ao Claude para escrever o roteiro ou adicione manualmente.</p>';
  }
  $('#vzFalas').addEventListener('change', (e) => {
    const linha = e.target.closest('.linha-fala');
    if (!linha || !e.target.dataset.campo) return;
    const f = a.voz.falas[+linha.dataset.i];
    if (e.target.dataset.campo === 'inicio') { f.inicio = +e.target.value; a.voz.falas.sort((x, y) => x.inicio - y.inicio); desenharFalas(); }
    else f.texto = e.target.value;
    salvar();
  });
  $('#vzFalas').addEventListener('click', (e) => {
    const linha = e.target.closest('.linha-fala');
    if (!linha) return;
    if (e.target.dataset.ouvir) new Audio(urlAudio(e.target.dataset.ouvir)).play();
    if (e.target.hasAttribute('data-rem')) { a.voz.falas.splice(+linha.dataset.i, 1); desenharFalas(); salvar(); }
  });
  $('#vzAdd').onclick = () => {
    const ult = a.voz.falas.at(-1);
    a.voz.falas.push({ inicio: ult ? +(ult.inicio + (ult.duracao || 2)).toFixed(1) : 0.3, texto: '' });
    desenharFalas(); salvar();
  };

  // ---------- sonoplastia
  const ICONE_CAT = { impacto: '💥', boom: '🔊', hit: '🥁', braam: '📯', whoosh: '💨', transicao: '↔', riser: '📈', reverse: '⏪', swell: '🌊', ui: '🖱', glitch: '⚡', textura: '✨', stinger: '⭐', foley: '🎬' };
  const ALINHAR = { inicio: 'começa em', fim: 'termina em', centro: 'centro em' };
  function ajustarMotor() {
    const m = a.efeitos.motor;
    $('#efTrilhaLinha').hidden = m !== 'codigo';
    $('#efBib').innerHTML = m === 'biblioteca'
      ? `${cacheBiblioteca.length} sons na biblioteca. <a href="#" id="efAbrirBib">abrir pasta</a> · <label style="display:inline;color:var(--acento-2);cursor:pointer">importar sons<input type="file" id="efImportar" multiple accept="audio/*" hidden></label>
         <br>Coloque sons que você pode usar (comprados, CC0 do Freesound, Pixabay, Mixkit). Os gerados pela ElevenLabs também ficam salvos aqui.`
      : m === 'elevenlabs' ? 'Cada som é gerado por IA a partir da descrição do plano, tratado (EQ, pan, reverb) e mixado. Fica salvo e não é cobrado de novo.'
        : 'A IA programa um sintetizador sob medida a partir do plano. Grátis e offline, com qualidade menor que a ElevenLabs.';
    const abrir = $('#efAbrirBib');
    if (abrir) abrir.onclick = (ev) => { ev.preventDefault(); api('/api/audio/biblioteca/abrir', { method: 'POST' }); };
    const imp = $('#efImportar');
    if (imp) imp.onchange = async () => {
      for (const f of imp.files) await fetch(`/api/audio/biblioteca/upload?nome=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      cacheBiblioteca = await api('/api/audio/biblioteca');
      toast(`${imp.files.length} som(ns) importado(s).`, 'ok');
      ajustarMotor(); desenharEfeitos();
    };
  }

  // linha do tempo "assistida": movimento, cortes, flashes, falas e cada som planejado
  function desenharPlano() {
    const e = a.efeitos;
    const an = e.analise;
    const D = an?.duracao || p.ajustes.duracao;
    const X = (t) => (Math.max(0, Math.min(D, t)) / D) * 1000;
    let svg = '';
    if (an) {
      const pts = an.curva.map((v, i) => `${X(i * 0.25).toFixed(1)},${(78 - v * 46).toFixed(1)}`).join(' ');
      svg += `<polyline points="0,78 ${pts} 1000,78" fill="rgba(90,169,255,.18)" stroke="#5aa9ff" stroke-width="1.5"/>`;
      for (const c of an.cortes) svg += `<line x1="${X(c.t)}" x2="${X(c.t)}" y1="26" y2="80" stroke="#ff5d5d" stroke-width="${1 + c.forca * 2}" opacity=".8"><title>corte ${c.t}s</title></line>`;
      for (const f of an.flashes) svg += `<rect x="${X(f.t) - 3}" y="26" width="6" height="54" fill="#fff" opacity="${0.15 + f.forca * 0.35}"><title>flash ${f.t}s</title></rect>`;
    }
    for (const s of e.silencios || []) svg += `<rect x="${X(s.inicio)}" y="20" width="${Math.max(2, X(s.fim) - X(s.inicio))}" height="64" fill="rgba(0,0,0,.55)"><title>silêncio dramático</title></rect>`;
    const falas = a.voz.provedor === 'arquivo' ? (a.voz.gravacao?.transcricao?.frases || []).map((f) => ({ inicio: f.inicio, duracao: f.fim - f.inicio, texto: f.texto })) : a.voz.falas;
    for (const f of falas || []) if (f.texto?.trim()) svg += `<rect x="${X(f.inicio)}" y="86" width="${Math.max(3, X(f.inicio + (f.duracao || 2)) - X(f.inicio))}" height="8" rx="3" fill="#3ecf8e" opacity=".7"><title>fala: ${esc(f.texto)}</title></rect>`;
    e.lista.forEach((x, i) => {
      const ini = x.alinhar === 'fim' ? x.inicio - x.duracao : x.alinhar === 'centro' ? x.inicio - x.duracao / 2 : x.inicio;
      svg += `<rect x="${X(ini)}" y="${6 + (i % 2) * 7}" width="${Math.max(3, X(ini + x.duracao) - X(ini))}" height="6" rx="2" fill="#ff6a3d" opacity=".55"/>`;
      svg += `<circle cx="${X(x.inicio)}" cy="${9 + (i % 2) * 7}" r="${4 + (x.camadas?.length ? 2 : 0)}" fill="#ff6a3d" data-som="${i}" style="cursor:pointer"><title>${ICONE_CAT[x.categoria] || '•'} ${x.inicio.toFixed(2)}s — ${esc(x.descricao)}</title></circle>`;
    });
    $('#efPlano').innerHTML = (e.conceito || an || e.lista.length) ? `
      ${e.conceito ? `<div class="conceito-som"><b>🎧 Conceito sonoro</b>${esc(e.conceito)}</div>` : ''}
      <svg class="linha-som" viewBox="0 0 1000 100" preserveAspectRatio="none">${svg}</svg>
      <div class="legenda-som"><span style="color:#ff6a3d">● sons</span><span style="color:#5aa9ff">▬ movimento</span><span style="color:#ff5d5d">| cortes</span><span style="color:#3ecf8e">▬ falas</span>${(e.silencios || []).length ? '<span>■ silêncio</span>' : ''}<span class="mono">${D.toFixed(1)}s</span></div>
      ${e.ambiente ? `<div class="linha-ambiente">🌫 <b>Ambiência</b>
        <input type="text" id="efAmbDesc" value="${esc(e.ambiente.descricao)}">
        <input type="range" id="efAmbVol" min="0" max="0.5" step="0.01" value="${e.ambiente.volume}" title="Volume da ambiência">
        <button type="button" class="btn mini" id="efAmbVar" title="Gerar outra variação">↻</button></div>` : ''}` : '';
    $$('#efPlano [data-som]').forEach((c) => c.onclick = () => $(`.linha-efeito[data-i="${c.dataset.som}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    if ($('#efAmbDesc')) {
      $('#efAmbDesc').onchange = (ev) => { e.ambiente.descricao = ev.target.value; salvar(); };
      $('#efAmbVol').onchange = (ev) => { e.ambiente.volume = +ev.target.value; salvar(); };
      $('#efAmbVar').onclick = () => { e.ambiente.variante = (e.ambiente.variante || 0) + 1; salvar(); toast('Nova variação da ambiência será gerada em "Gerar sonoplastia".'); };
    }
  }

  function desenharEfeitos() {
    const bib = a.efeitos.motor === 'biblioteca';
    $('#efLista').innerHTML = a.efeitos.lista.length ? a.efeitos.lista.map((x, i) => `
      <div class="linha-efeito v2" data-i="${i}">
        <div class="ef-topo">
          <span class="ef-icone" title="${esc(x.categoria || '')}">${ICONE_CAT[x.categoria] || '•'}</span>
          <select data-campo="alinhar" title="Como o som se alinha ao tempo">${Object.entries(ALINHAR).map(([k, v]) => `<option value="${k}" ${(x.alinhar || 'inicio') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <input type="number" step="0.05" min="0" value="${x.inicio}" data-campo="inicio" title="Tempo (s)">
          <input type="number" step="0.1" min="0.4" max="30" value="${x.duracao}" data-campo="duracao" title="Duração (s)">
          <span class="espaco"></span>
          ${x.gerado ? `<button type="button" class="btn mini" data-ouvir="${esc(x.gerado)}" title="Ouvir este som">▶</button>` : ''}
          ${a.efeitos.motor === 'elevenlabs' ? '<button type="button" class="btn mini" data-variar title="Trocar por outra variação">↻</button>' : ''}
          <button type="button" class="btn mini perigo" data-rem title="Remover">✕</button>
        </div>
        <input type="text" value="${esc(x.descricao)}" data-campo="descricao" title="Descrição do som (em inglês funciona melhor)">
        ${x.camadas?.length ? `<small class="ef-camadas">+ ${x.camadas.length} camada(s): ${esc(x.camadas.join(' · '))}</small>` : ''}
        <div class="ef-controles">
          <label>Vol<input type="range" min="0" max="1.2" step="0.05" value="${x.volume}" data-campo="volume"></label>
          <label>Pan<input type="range" min="-1" max="1" step="0.1" value="${x.pan || 0}" data-campo="pan" title="Esquerda ↔ direita"></label>
          <label>Reverb<input type="range" min="0" max="1" step="0.05" value="${x.reverb || 0}" data-campo="reverb"></label>
        </div>
        ${x.motivo ? `<small class="ef-motivo">💡 ${esc(x.motivo)}</small>` : ''}
        ${bib ? `<select data-campo="arquivoBiblioteca"><option value="">(sem som da biblioteca)</option>${cacheBiblioteca.map((b) => `<option ${b === x.arquivoBiblioteca ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>` : ''}
      </div>`).join('') : '<p class="ajuda" style="margin:0">Nenhum som planejado. Clique em <b>👁 Assistir ao vídeo e desenhar o som</b>.</p>';
    desenharPlano();
  }
  $('#efLista').addEventListener('change', (ev) => {
    const linha = ev.target.closest('.linha-efeito');
    const campo = ev.target.dataset.campo;
    if (!linha || !campo) return;
    const x = a.efeitos.lista[+linha.dataset.i];
    x[campo] = ['inicio', 'duracao', 'volume', 'pan', 'reverb'].includes(campo) ? +ev.target.value : (ev.target.value || null);
    if (campo === 'inicio') a.efeitos.lista.sort((m, n) => m.inicio - n.inicio);
    if (['inicio', 'duracao', 'alinhar', 'arquivoBiblioteca'].includes(campo)) desenharEfeitos(); else desenharPlano();
    salvar();
  });
  $('#efLista').addEventListener('click', (ev) => {
    const linha = ev.target.closest('.linha-efeito');
    if (!linha) return;
    const x = a.efeitos.lista[+linha.dataset.i];
    const ouvir = ev.target.closest('[data-ouvir]');
    if (ouvir) { audioAmostra.src = `/p/${p.id}/audio/sfx/${encodeURIComponent(ouvir.dataset.ouvir)}`; audioAmostra.play().catch(() => {}); }
    if (ev.target.closest('[data-variar]')) { x.variante = (x.variante || 0) + 1; x.gerado = null; salvar(); desenharEfeitos(); toast('Nova variação deste som será gerada em "Gerar sonoplastia" (só ele é refeito).'); }
    if (ev.target.closest('[data-rem]')) { a.efeitos.lista.splice(+linha.dataset.i, 1); desenharEfeitos(); salvar(); }
  });
  $('#efAdd').onclick = () => {
    a.efeitos.lista.push({ inicio: 0, alinhar: 'inicio', duracao: 1, categoria: 'whoosh', descricao: 'fast airy whoosh transition', camadas: [], volume: 0.8, pan: 0, reverb: 0.2, variante: 0, arquivoBiblioteca: null });
    a.efeitos.lista.sort((m, n) => m.inicio - n.inicio);
    desenharEfeitos(); salvar();
  };
  $('#efMotor').onchange = async (ev) => {
    a.efeitos.motor = ev.target.value;
    if (a.efeitos.motor === 'biblioteca') cacheBiblioteca = await api('/api/audio/biblioteca');
    ajustarMotor(); desenharEfeitos(); salvar();
  };
  $$('#efEstilos button').forEach((b) => b.onclick = () => {
    a.efeitos.estilo = b.dataset.estilo;
    $('#efEstilo').value = a.efeitos.estilo;
    $$('#efEstilos button').forEach((x) => x.classList.toggle('ativa', x === b));
    salvar();
  });
  $$('#efIntensidade button').forEach((b) => b.onclick = () => {
    a.efeitos.intensidade = b.dataset.int;
    $$('#efIntensidade button').forEach((x) => x.classList.toggle('ativa', x === b));
    salvar();
  });
  $('#efAmbiente').onchange = (ev) => { a.efeitos.comAmbiente = ev.target.checked; salvar(); };
  $('#efEstilo').onchange = (ev) => { a.efeitos.estilo = ev.target.value; $$('#efEstilos button').forEach((x) => x.classList.toggle('ativa', x.dataset.estilo === a.efeitos.estilo)); salvar(); };
  $('#efTrilha').onchange = (ev) => { a.efeitos.comTrilha = ev.target.checked; salvar(); };
  $('#efVol').oninput = (ev) => { a.efeitos.volume = +ev.target.value; salvar(); };
  $('#efAtivo').onchange = (ev) => { a.efeitos.ativo = ev.target.checked; salvar(); };

  // ---------- jobs
  async function rodar(rota, botao) {
    await salvar(true);
    $$('#pCorpo button.btn').forEach((b) => { b.disabled = true; });
    $('#sJob').hidden = false;
    try {
      const { job } = await api(`/api/projetos/${p.id}/audio/${rota}`, { corpo: { modelo: $('#sModelo').value } });
      const fim = await acompanharJob(job.id, (j) => {
        if (!$('#sJob')) return;
        $('#sJob i').style.width = `${Math.round((j.progresso || 0.05) * 100)}%`;
        $('#sJobMsg').textContent = j.erro || j.ultima || '';
      });
      if (fim.status === 'ok') toast(`${botao}: pronto!`, 'ok');
      else toast(`${botao} falhou: ${fim.erro}`, 'erro');
    } catch (e) { toast(e.message, 'erro'); }
    if (estado.projetoAberto === p.id && estado.abaProjeto === 'som') {
      p = await api(`/api/projetos/${p.id}`);
      desenharAbaSom(p, $('#pCorpo'));
    }
  }
  $('#vzRoteiro').onclick = () => {
    if (a.voz.falas.length && !confirm('Substituir as falas atuais por um roteiro novo?')) return;
    rodar('roteiro', 'Roteiro');
  };
  $('#vzGerar').onclick = () => rodar('voz', 'Voz');
  $('#efMapa').onclick = () => {
    if (a.efeitos.lista.length && !confirm('Substituir o plano de som atual por um novo?')) return;
    rodar('mapa', 'Plano de som');
  };
  $('#efGerar').onclick = () => rodar('efeitos', 'Sonoplastia');

  desenharFalas();
  ajustarMotor();
  desenharEfeitos();
  statusFaixas();
  carregarVozes();

  // se já havia uma tarefa de áudio rodando (ex.: voltou para a aba), acompanha
  const emCurso = await api(`/api/projetos/${p.id}/audio/job`);
  if (emCurso && (emCurso.status === 'rodando' || emCurso.status === 'fila')) {
    $$('#pCorpo button.btn').forEach((b) => { b.disabled = true; });
    $('#sJob').hidden = false;
    await acompanharJob(emCurso.id, (j) => {
      if (!$('#sJob')) return;
      $('#sJob i').style.width = `${Math.round((j.progresso || 0.05) * 100)}%`;
      $('#sJobMsg').textContent = j.erro || j.ultima || '';
    });
    if (estado.projetoAberto === p.id && estado.abaProjeto === 'som') desenharAbaSom(await api(`/api/projetos/${p.id}`), $('#pCorpo'));
  }
}

// ===================================================================== SELETOR DE VOZES (estilo ElevenLabs)
const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'K' : String(n || 0));
const GENEROS = { female: 'Feminina', male: 'Masculina', neutral: 'Neutra' };
const IDADES = { young: 'Jovem', middle_aged: 'Meia-idade', 'middle aged': 'Meia-idade', old: 'Madura' };
const corAvatar = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return `linear-gradient(135deg,hsl(${h} 55% 45%),hsl(${(h + 50) % 360} 60% 30%))`; };
const audioAmostra = new Audio();

function abrirSeletorVozes(atualId, aoEscolher) {
  const st = { aba: 'explorar', busca: '', genero: '', ordem: 'alta', pagina: 0, vozes: [], temMais: false, tocando: null, carregando: false };
  $('#modal').innerHTML = `<div class="modal-caixa simples seletor-vozes"><button class="fechar">×</button>
    <div class="sv-topo">
      <div class="sv-abas"><button data-aba="explorar" class="ativa">Explorar</button><button data-aba="minhas">Minhas vozes</button></div>
      <div class="sv-busca"><span>⌕</span><input id="svBusca" placeholder="Buscar voz pelo nome, estilo…"><button id="svLimpar" title="Limpar">×</button></div>
    </div>
    <div class="sv-filtros">
      <div class="sv-chips" id="svGenero"><button data-g="" class="ativa">Todas</button><button data-g="female">Femininas</button><button data-g="male">Masculinas</button></div>
      <select id="svOrdem"><option value="alta">Em alta</option><option value="usadas">Mais usadas</option><option value="recentes">Mais recentes</option></select>
    </div>
    <div class="sv-contagem" id="svContagem">carregando…</div>
    <div class="sv-lista" id="svLista"></div>
    <button class="btn" id="svMais" hidden>Carregar mais vozes</button>
  </div>`;
  $('#modal').hidden = false;
  const fechar = () => { audioAmostra.pause(); fecharModal(); };
  $('#modal .fechar').onclick = fechar;

  async function carregar(reset) {
    if (st.carregando) return;
    st.carregando = true;
    if (reset) { st.pagina = 0; st.vozes = []; $('#svLista').innerHTML = '<p class="sv-vazio">Carregando vozes…</p>'; }
    try {
      const q = new URLSearchParams({ pagina: st.pagina, genero: st.genero, busca: st.busca, ordem: st.ordem });
      const r = await fetch(st.aba === 'explorar' ? `/api/audio/eleven/biblioteca?${q}` : `/api/audio/eleven/minhas?${q}`);
      const d = await r.json();
      if (!r.ok) {
        st.carregando = false;
        $('#svContagem').textContent = '';
        $('#svMais').hidden = true;
        $('#svLista').innerHTML = d.semPermissao
          ? `<div class="sv-aviso"><b>Falta uma permissão na sua chave da ElevenLabs</b>
              Para listar as vozes (igual ao site), a chave precisa da permissão <b>Voices → Read</b>
              (e <b>Voices → Write</b> para usar vozes da biblioteca).
              <ol><li>Abra <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener">elevenlabs.io → Settings → API Keys</a></li>
              <li>Clique na sua chave → em <b>Voices</b> marque <b>Read</b> e <b>Write</b> → Salvar</li>
              <li>Volte aqui e reabra esta janela (não precisa colar a chave de novo)</li></ol></div>`
          : `<div class="sv-aviso">${esc(d.erro)}</div>`;
        return;
      }
      let novas = d.vozes;
      if (st.aba === 'minhas' && st.genero) novas = novas.filter((v) => (v.info || '').includes(st.genero === 'female' ? 'feminina' : 'masculina'));
      st.vozes.push(...novas);
      st.temMais = !!d.temMais;
      desenhar(d.total);
    } catch (e) {
      $('#svLista').innerHTML = `<div class="sv-aviso">${esc(e.message)}</div>`;
    }
    st.carregando = false;
  }

  function desenhar(total) {
    $('#svContagem').textContent = `${total ?? st.vozes.length}${st.temMais && total == null ? '+' : ''} vozes`;
    $('#svMais').hidden = !st.temMais;
    $('#svLista').innerHTML = st.vozes.length ? st.vozes.map((v, i) => {
      const iniciais = v.nome.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
      const caracts = [GENEROS[v.genero] || '', IDADES[v.idade] || v.idade, v.estilo, v.uso].filter(Boolean).map((x) => String(x).replace(/_/g, ' '));
      return `<div class="sv-linha ${v.id === atualId ? 'escolhida' : ''}" data-i="${i}">
        <button class="sv-avatar" data-tocar="${i}" title="Ouvir amostra" style="${v.imagem ? `background-image:url('${esc(v.imagem)}')` : `background:${corAvatar(v.nome)}`}">
          ${v.imagem ? '' : `<span>${esc(iniciais)}</span>`}<i class="sv-play">${st.tocando === i ? '❚❚' : '▶'}</i>
          ${v.verificada ? '<em class="sv-selo">✓</em>' : ''}
        </button>
        <div class="sv-nome"><b title="${esc(v.nome)}">${esc(v.nome)}</b>
          <small>${caracts.length ? caracts.map((c) => `<span>${esc(c)}</span>`).join('') : esc(v.info || '')}</small></div>
        <div class="sv-idioma">${st.aba === 'explorar' ? `🇧🇷 <span>Portuguese</span> <em>Brasileiro</em>${v.idiomasExtras ? ` <i>+${v.idiomasExtras}</i>` : ''}` : ''}</div>
        <div class="sv-meta">${v.criada ? `<span title="Publicada há">🕓 ${esc(v.criada)}</span>` : ''}${st.aba === 'explorar' ? `<span title="Usuários">👥 ${fmtNum(v.usuarios)}</span>` : ''}</div>
        <button class="btn mini ${v.id === atualId ? '' : 'primario'}" data-usar="${i}">${v.id === atualId ? '✓ Escolhida' : 'Usar'}</button>
      </div>`;
    }).join('') : '<p class="sv-vazio">Nenhuma voz encontrada.</p>';
  }

  $('#svLista').addEventListener('click', (e) => {
    const tocar = e.target.closest('[data-tocar]');
    if (tocar) {
      const i = +tocar.dataset.tocar;
      const v = st.vozes[i];
      if (st.tocando === i) { audioAmostra.pause(); st.tocando = null; desenhar(); return; }
      if (!v.preview) return toast('Esta voz não tem amostra.', 'erro');
      audioAmostra.src = v.preview;
      audioAmostra.play().catch(() => toast('Não consegui tocar a amostra.', 'erro'));
      st.tocando = i;
      audioAmostra.onended = () => { st.tocando = null; desenhar(); };
      desenhar();
      return;
    }
    const usar = e.target.closest('[data-usar]');
    if (usar) {
      const v = st.vozes[+usar.dataset.usar];
      aoEscolher(v);
      fechar();
      toast(`Voz escolhida: ${v.nome}`, 'ok');
    }
  });
  $$('.sv-abas button').forEach((b) => b.onclick = () => {
    st.aba = b.dataset.aba;
    $$('.sv-abas button').forEach((x) => x.classList.toggle('ativa', x === b));
    $('#svOrdem').hidden = st.aba !== 'explorar';
    carregar(true);
  });
  $$('#svGenero button').forEach((b) => b.onclick = () => {
    st.genero = b.dataset.g;
    $$('#svGenero button').forEach((x) => x.classList.toggle('ativa', x === b));
    carregar(true);
  });
  let tBusca;
  $('#svBusca').oninput = (e) => { clearTimeout(tBusca); tBusca = setTimeout(() => { st.busca = e.target.value.trim(); carregar(true); }, 350); };
  $('#svLimpar').onclick = () => { $('#svBusca').value = ''; st.busca = ''; carregar(true); };
  $('#svOrdem').onchange = (e) => { st.ordem = e.target.value; carregar(true); };
  $('#svMais').onclick = () => { st.pagina++; carregar(false); };
  carregar(true);
}

// ===================================================================== CONFIGURAÇÕES
async function abrirConfiguracoes() {
  const c = await api('/api/config');
  const el = c.elevenlabs;
  $('#modal').innerHTML = `<div class="modal-caixa simples"><button class="fechar">×</button>
    <div class="modal-dir">
      <h2>⚙ Configurações</h2>
      <h3 style="margin:4px 0 0">ElevenLabs (vozes e efeitos sonoros por IA)</h3>
      <div id="cfgEleven">${el.configurado ? `Chave configurada (termina em <b>${esc(el.final)}</b>). <span id="cfgPlano" class="mono">verificando…</span>` : 'Nenhuma chave configurada.'}</div>
      <label>Chave de API
        <input type="password" id="cfgChave" placeholder="${el.configurado ? 'cole uma chave nova para trocar' : 'cole aqui a sua chave da ElevenLabs'}" autocomplete="off">
      </label>
      <p class="ajuda" style="margin:0">Crie a chave em <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener">elevenlabs.io → Settings → API Keys</a>
        (permissões necessárias: <b>Text to Speech</b>, <b>Sound Effects</b> e <b>Voices → Read</b>; “User → Read” é opcional, só mostra os créditos). A chave fica salva só neste PC, em <span class="mono">dados/config.json</span>.</p>
      <div class="linha" style="flex:none">
        <button class="btn primario" id="cfgSalvar">Salvar e testar</button>
        ${el.configurado ? '<button class="btn perigo" id="cfgRemover">Remover chave</button>' : ''}
      </div>
      <h3 style="margin:10px 0 0">Vozes grátis</h3>
      <p class="ajuda" style="margin:0"><b>Piper</b>: vozes neurais offline (o modelo de cada voz, ~60 MB, é baixado no primeiro uso). <b>Windows</b>: vozes instaladas no sistema (ex.: Maria, pt-BR).</p>
    </div></div>`;
  $('#modal').hidden = false;
  $('#modal .fechar').onclick = fecharModal;
  if (el.configurado) {
    api('/api/config/elevenlabs').then((i) => {
      if ($('#cfgPlano')) $('#cfgPlano').textContent = `Plano ${i.plano} · ${i.usados?.toLocaleString('pt-BR')} de ${i.limite?.toLocaleString('pt-BR')} créditos usados`;
    }).catch((e) => {
      if ($('#cfgPlano')) $('#cfgPlano').textContent = /permission/i.test(e.message)
        ? '(a chave não tem permissão “User → Read”, então o plano não aparece; a geração funciona normalmente)'
        : e.message;
    });
  }
  $('#cfgSalvar').onclick = async () => {
    const chave = $('#cfgChave').value.trim();
    if (!chave) return toast('Cole a chave primeiro.', 'erro');
    $('#cfgSalvar').disabled = true;
    try {
      const r = await api('/api/config', { method: 'PUT', corpo: { elevenlabsKey: chave } });
      delete cacheVozes.elevenlabs;
      toast(`ElevenLabs conectada!${r.elevenlabs?.plano ? ` Plano ${r.elevenlabs.plano}.` : ''}`, 'ok');
      for (const aviso of r.avisos || []) toast('Aviso: ' + aviso);
      fecharModal();
      if (estado.projetoAberto && estado.abaProjeto === 'som') renderizarDetalhe(true);
    } catch (e) { toast(e.message, 'erro'); $('#cfgSalvar').disabled = false; }
  };
  $('#cfgRemover') && ($('#cfgRemover').onclick = async () => {
    await api('/api/config', { method: 'PUT', corpo: { elevenlabsKey: '' } });
    delete cacheVozes.elevenlabs;
    toast('Chave removida.');
    fecharModal();
  });
}
$('#btnConfig').addEventListener('click', abrirConfiguracoes);

function itemRender(m) {
  return `<div class="render-item">
    <video src="/arquivos/midia/${encodeURIComponent(m.nome)}#t=0.5" muted preload="metadata"></video>
    <div><b>${esc(m.nome)}</b><br><span class="mono">${m.largura}×${m.altura} · ${m.duracao.toFixed(1)}s</span></div>
    <a class="btn mini" href="/arquivos/midia/${encodeURIComponent(m.nome)}" download>⬇</a>
    <button class="btn mini" data-ao-editor="${esc(m.nome)}">→ Editor</button>
  </div>`;
}
function ligarItensRender(c) {
  $$('[data-ao-editor]', c).forEach((b) => b.onclick = async () => {
    await carregarMidia();
    adicionarClipe(b.dataset.aoEditor);
    irPara('editor');
  });
  $$('.render-item video', c).forEach((v) => {
    v.onmouseenter = () => v.play();
    v.onmouseleave = () => v.pause();
  });
}

// ===================================================================== EDITOR (estilo CapCut)
const legendasPadrao = () => ({ ativo: true, estilo: 'capcut', tam: 'm', pos: 'base', maiusculas: true, porLegenda: 3, palavras: [], itens: [] });
const ed = {
  nome: 'Meu vídeo', formato: '9:16', fps: 30, encaixe: 'cobrir', clipes: [], musica: null, audios: [], textos: [], legendas: legendasPadrao(),
};
let selecionado = null; // 'c:uid' | 't:uid' | 'a:uid' | 'musica' | 'leg'
let abaClipe = 'editar';
let cab = 0; // cabeçote (segundos)
let pxPorSeg = 60;
const uid = () => Math.random().toString(36).slice(2, 9);
const midiaPorNome = (n) => estado.midias.find((m) => m.nome === n);
const urlMidia = (n) => `/arquivos/midia/${encodeURIComponent(n)}`;
const clipeQuebrado = (c) => c.tipo !== 'cartela' && !midiaPorNome(c.midia);
const ehFixo = (c) => c.tipo === 'cartela' || clipeQuebrado(c) || midiaPorNome(c.midia)?.tipo === 'imagem';
const velC = (c) => Math.min(4, Math.max(0.25, +c.velocidade || 1));
const durClipe = (c) => (ehFixo(c) ? Math.max(0.2, +c.duracaoImagem || 3) : Math.max(0.1, (c.fim - c.inicio) / velC(c)));
const durAudio = (x) => {
  const resto = Math.max(0.1, (midiaPorNome(x.midia)?.duracao || 1) - (+x.cortarInicio || 0));
  return +x.duracao > 0 ? Math.min(+x.duracao, resto) : resto;
};
const textoPadrao = () => ({ texto: '', textoPos: 'base', textoTam: 'm', textoCor: '#ffffff', textoFundo: false, fonte: 'negrito', textoAnimado: true });

// posição de cada clipe (mesma regra do servidor: transição sobrepõe o fim de um clipe com o começo do próximo)
function layoutTL() {
  const itens = [];
  let t = 0;
  ed.clipes.forEach((c, i) => {
    const dur = durClipe(c);
    const prox = ed.clipes[i + 1];
    let x = 0;
    if (prox && c.transicao?.tipo && c.transicao.tipo !== 'nenhuma') x = Math.min(+c.transicao.dur || 0.5, dur / 2, durClipe(prox) / 2);
    itens.push({ inicio: t, dur, x });
    t += dur - x;
  });
  const ult = itens.at(-1);
  return { itens, total: ult ? ult.inicio + ult.dur : 0 };
}
const totalTimeline = () => layoutTL().total;
function clipeNoTempo(t) {
  const L = layoutTL();
  for (let i = L.itens.length - 1; i >= 0; i--) if (t >= L.itens[i].inicio - 1e-6) return { i, c: ed.clipes[i], it: L.itens[i], L };
  return null;
}
const quadro = () => 1 / (ed.fps || 30);

// ---------- histórico (desfazer/refazer) + salvar
const hist = { pilha: [], i: -1 };
function registrar() {
  const s = JSON.stringify(ed);
  if (hist.pilha[hist.i] === s) return;
  hist.pilha = hist.pilha.slice(0, hist.i + 1);
  hist.pilha.push(s);
  if (hist.pilha.length > 150) hist.pilha.shift();
  hist.i = hist.pilha.length - 1;
  atualizarBotoesHist();
}
function atualizarBotoesHist() {
  $('#tbDesfazer').disabled = hist.i <= 0;
  $('#tbRefazer').disabled = hist.i >= hist.pilha.length - 1;
}
let tSalvar;
const salvarEdicao = () => {
  clearTimeout(tSalvar);
  tSalvar = setTimeout(() => { registrar(); api('/api/edicao', { method: 'PUT', corpo: ed }).catch(() => {}); }, 300);
};
function restaurarHist(d) {
  const j = hist.i + d;
  if (j < 0 || j >= hist.pilha.length) return;
  clearTimeout(tSalvar);
  hist.i = j;
  const o = JSON.parse(hist.pilha[j]);
  for (const k of Object.keys(ed)) delete ed[k];
  Object.assign(ed, o);
  api('/api/edicao', { method: 'PUT', corpo: ed }).catch(() => {});
  sincronizarTopo();
  atualizarBotoesHist();
  selecionar(existe(selecionado) ? selecionado : null);
}
const existe = (sel) => {
  if (!sel) return false;
  const [t, u] = sel.split(':');
  if (t === 'c') return ed.clipes.some((c) => c.uid === u);
  if (t === 't') return ed.textos.some((x) => x.uid === u);
  if (t === 'a') return ed.audios.some((x) => x.uid === u);
  if (sel === 'musica') return !!ed.musica;
  if (sel === 'leg') return true;
  return false;
};
$('#tbDesfazer').onclick = () => restaurarHist(-1);
$('#tbRefazer').onclick = () => restaurarHist(1);

$('#edFormato').innerHTML = FORMATOS.map((f) => `<option value="${f.id}">${f.curto} · ${f.nome} (${f.largura}×${f.altura})</option>`).join('');

async function carregarMidia() {
  estado.midias = await api('/api/midia');
  desenharMidia();
  desenharTimeline();
}

// ---------- coluna de mídia
function desenharMidia() {
  const lista = estado.midias.filter((m) => !estado.filtroMidia || m.tipo === estado.filtroMidia);
  $('#listaMidia').innerHTML = lista.length ? lista.map((m) => `
    <div class="item-midia" data-nome="${esc(m.nome)}" draggable="true" title="Arraste para a timeline">
      <div class="thumb" style="${m.thumb ? `background-image:url('/arquivos/miniaturas/${encodeURIComponent(m.thumb)}')` : ''}">${m.tipo === 'audio' ? '🎵' : ''}</div>
      <div class="info"><b title="${esc(m.titulo || m.nome)}">${esc(m.titulo || m.nome)}</b>
        <small>${{ video: 'vídeo', imagem: 'imagem', audio: 'áudio' }[m.tipo]}${m.duracao ? ' · ' + m.duracao.toFixed(1) + 's' : ''}${m.tipo === 'video' ? (m.temAudio ? ' · 🔊' : ' · 🔇 sem som') : ''}${m.origem === 'render' ? ' · render' : m.origem === 'edicao' ? ' · exportado' : ''}</small>
        <div class="acoes-midia">
          ${m.tipo === 'audio'
            ? '<button class="btn mini" data-acao="musica" title="Música de fundo do vídeo inteiro">♪ Trilha</button><button class="btn mini" data-acao="audio" title="No ponto do cabeçote">＋ Áudio</button>'
            : '<button class="btn mini" data-acao="add">＋ Timeline</button>'}
          <a class="btn mini" href="${urlMidia(m.nome)}" download title="Baixar">⬇</a>
          <button class="btn mini perigo" data-acao="del" title="Apagar do disco">✕</button>
        </div>
      </div>
    </div>`).join('') : '<p class="ajuda" style="padding:8px">Nada aqui ainda. Use <b>＋ Adicionar</b>, arraste arquivos para cá ou renderize um projeto.</p>';
}
$('#filtroMidia').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  estado.filtroMidia = b.dataset.f;
  $$('#filtroMidia button').forEach((x) => x.classList.toggle('ativa', x === b));
  desenharMidia();
});
$('#listaMidia').addEventListener('click', async (e) => {
  const item = e.target.closest('.item-midia');
  if (!item) return;
  const nome = item.dataset.nome;
  const acao = e.target.closest('[data-acao]')?.dataset.acao;
  if (acao === 'add') adicionarClipe(nome);
  else if (acao === 'musica') definirTrilha(nome);
  else if (acao === 'audio') adicionarAudio(nome, cab);
  else if (acao === 'del') {
    if (!confirm(`Apagar "${nome}" do disco?`)) return;
    await api(`/api/midia/${encodeURIComponent(nome)}`, { method: 'DELETE' });
    ed.clipes = ed.clipes.filter((c) => c.midia !== nome);
    ed.audios = ed.audios.filter((x) => x.midia !== nome);
    if (ed.musica?.midia === nome) ed.musica = null;
    salvarEdicao();
    carregarMidia();
  }
});
$('#listaMidia').addEventListener('dragstart', (e) => {
  const item = e.target.closest('.item-midia');
  if (!item) return;
  e.dataTransfer.setData('text/x-midia', item.dataset.nome);
  e.dataTransfer.effectAllowed = 'copy';
  document.body.classList.add('arrastando-midia');
});
document.addEventListener('dragend', () => document.body.classList.remove('arrastando-midia'));
$('#btnAbrirPasta').onclick = () => api('/api/midia/abrir-pasta', { method: 'POST' });

async function enviarArquivos(arquivos) {
  const criados = [];
  for (const f of arquivos) {
    toast(`Importando ${f.name}…`);
    try {
      const r = await fetch(`/api/midia/upload?nome=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro || r.status);
      criados.push(d);
    } catch (e) { toast(`Falha em ${f.name}: ${e.message}`, 'erro'); }
  }
  await carregarMidia();
  if (criados.length) toast(`${criados.length} arquivo(s) importado(s).`, 'ok');
  return criados;
}
$('#inputUpload').addEventListener('change', (e) => { enviarArquivos([...e.target.files]); e.target.value = ''; });
const colMidia = $('.ed-midia');
colMidia.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); colMidia.classList.add('arrastando'); } });
colMidia.addEventListener('dragleave', () => colMidia.classList.remove('arrastando'));
colMidia.addEventListener('drop', (e) => {
  colMidia.classList.remove('arrastando');
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  enviarArquivos([...e.dataTransfer.files]);
});

// ---------- ＋ Adicionar
const menuAdd = $('#menuAdicionar');
$('#btnAdicionar').onclick = (e) => { e.stopPropagation(); menuAdd.hidden = !menuAdd.hidden; };
document.addEventListener('click', (e) => { if (!e.target.closest('#menuAdicionar')) menuAdd.hidden = true; });
menuAdd.addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  menuAdd.hidden = true;
  const qual = b.dataset.add;
  if (qual === 'cartela') return adicionarCartela();
  if (qual === 'texto') return adicionarTexto();
  if (qual === 'legendas') return gerarLegendas();
  if (qual === 'midia') return toast('Arraste um item da coluna Mídia para a timeline, ou use os botões dele.');
  $({ video: '#upVideo', trilha: '#upTrilha', audio: '#upAudio' }[qual]).click();
});
$('#upVideo').onchange = async (e) => {
  const itens = await enviarArquivos([...e.target.files]);
  e.target.value = '';
  for (const it of itens) if (it.tipo !== 'audio') adicionarClipe(it.nome, { silencioso: itens.length > 1 });
};
$('#upTrilha').onchange = async (e) => {
  const [it] = await enviarArquivos([...e.target.files]);
  e.target.value = '';
  if (it) definirTrilha(it.nome);
};
$('#upAudio').onchange = async (e) => {
  const itens = await enviarArquivos([...e.target.files]);
  e.target.value = '';
  for (const it of itens) adicionarAudio(it.nome, cab);
};

// ---------- operações
function ajustarFormatoPeloPrimeiro(m) {
  if (ed.clipes.length || !m?.largura || !m?.altura) return;
  const r = m.largura / m.altura;
  const f = FORMATOS.reduce((a, b) => (Math.abs(b.largura / b.altura - r) < Math.abs(a.largura / a.altura - r) ? b : a));
  ed.formato = f.id;
  $('#edFormato').value = f.id;
  ajustarPalco();
}
function adicionarClipe(nome, { posicao, silencioso } = {}) {
  const m = midiaPorNome(nome);
  if (!m) return toast('Mídia não encontrada.', 'erro');
  if (m.tipo === 'audio') return adicionarAudio(nome, cab);
  ajustarFormatoPeloPrimeiro(m);
  const c = {
    uid: uid(), midia: nome, inicio: 0, fim: m.duracao || 3, duracaoImagem: 3, velocidade: 1, volume: 1, mudo: false,
    fadeIn: 0, fadeOut: 0, filtro: { preset: '', brilho: 0, contraste: 1, saturacao: 1 }, transicao: { tipo: 'nenhuma', dur: 0.5 }, zoom: 'nenhum', ...textoPadrao(),
  };
  ed.clipes.splice(posicao ?? ed.clipes.length, 0, c);
  salvarEdicao();
  selecionar('c:' + c.uid);
  if (!silencioso) toast(m.tipo === 'video' && !m.temAudio ? 'Clipe adicionado (este vídeo não tem som próprio).' : 'Clipe adicionado à timeline.', 'ok');
}
function adicionarCartela(posicao) {
  const c = {
    uid: uid(), tipo: 'cartela', cor: '#111111', duracaoImagem: 2.5, velocidade: 1, volume: 0, fadeIn: 0, fadeOut: 0,
    filtro: { preset: '', brilho: 0, contraste: 1, saturacao: 1 }, transicao: { tipo: 'nenhuma', dur: 0.5 }, zoom: 'nenhum',
    ...textoPadrao(), texto: 'Seu texto aqui', textoPos: 'centro', textoTam: 'g',
  };
  ed.clipes.splice(posicao ?? ed.clipes.length, 0, c);
  salvarEdicao();
  selecionar('c:' + c.uid);
}
function adicionarTexto() {
  const fimTL = Math.max(totalTimeline(), 3);
  const ini = Math.min(cab, Math.max(0, fimTL - 0.5));
  const t = { uid: uid(), texto: 'Seu texto', inicio: +ini.toFixed(2), fim: +Math.min(ini + 2.5, Math.max(fimTL, ini + 2.5)).toFixed(2), pos: 'centro', y: 50, tam: 'g', estilo: 'contorno', cor: '', fonte: 'negrito', anim: 'pop' };
  ed.textos.push(t);
  salvarEdicao();
  selecionar('t:' + t.uid);
  setTimeout(() => $('#xTexto')?.select(), 50);
}
function definirTrilha(nome) {
  if (!midiaPorNome(nome)) return toast('Mídia não encontrada.', 'erro');
  ed.musica = { midia: nome, volume: 0.5, fadeIn: 0.5, fadeOut: 2 };
  salvarEdicao();
  selecionar('musica');
  toast('Trilha sonora definida: toca do início ao fim (repete se for curta).', 'ok');
}
function adicionarAudio(nome, inicio = cab) {
  const m = midiaPorNome(nome);
  if (!m) return toast('Mídia não encontrada.', 'erro');
  if (m.tipo !== 'audio' && !m.temAudio) return toast('Esse arquivo não tem áudio.', 'erro');
  const x = { uid: uid(), midia: nome, inicio: +Math.max(0, inicio).toFixed(2), cortarInicio: 0, duracao: 0, volume: 1, fadeIn: 0, fadeOut: 0.1 };
  ed.audios.push(x);
  salvarEdicao();
  selecionar('a:' + x.uid);
  toast(`Áudio colocado em ${x.inicio.toFixed(1)}s.`, 'ok');
}

function dividir() {
  const [tipo, u] = (selecionado || '').split(':');
  if (tipo === 't') {
    const t = ed.textos.find((x) => x.uid === u);
    if (!t || cab <= t.inicio + 0.05 || cab >= t.fim - 0.05) return toast('Posicione o cabeçote dentro do texto selecionado.', 'erro');
    const n = { ...t, uid: uid(), inicio: +cab.toFixed(3) };
    t.fim = +cab.toFixed(3);
    ed.textos.push(n);
    salvarEdicao(); return selecionar('t:' + n.uid);
  }
  if (tipo === 'a') {
    const x = ed.audios.find((a) => a.uid === u);
    const d = x && durAudio(x);
    if (!x || cab <= x.inicio + 0.05 || cab >= x.inicio + d - 0.05) return toast('Posicione o cabeçote dentro do áudio selecionado.', 'erro');
    const corte = cab - x.inicio;
    const n = { ...x, uid: uid(), inicio: +cab.toFixed(3), cortarInicio: (+x.cortarInicio || 0) + corte, duracao: x.duracao ? x.duracao - corte : 0 };
    x.duracao = corte;
    ed.audios.push(n);
    salvarEdicao(); return selecionar('a:' + n.uid);
  }
  const hit = clipeNoTempo(cab);
  if (!hit) return toast('Não há clipe no cabeçote.', 'erro');
  const { c, it } = hit;
  const local = cab - it.inicio;
  if (local < 0.05 || local > it.dur - 0.05) return toast('Coloque o cabeçote no meio do clipe para dividir.', 'erro');
  let novo;
  if (ehFixo(c)) {
    novo = { ...structuredClone(c), uid: uid(), duracaoImagem: +(c.duracaoImagem - local).toFixed(3) };
    c.duracaoImagem = +local.toFixed(3);
  } else {
    const tMidia = c.inicio + local * velC(c);
    novo = { ...structuredClone(c), uid: uid(), inicio: +tMidia.toFixed(3) };
    c.fim = +tMidia.toFixed(3);
  }
  novo.fadeIn = 0;
  c.fadeOut = 0;
  c.transicao = { tipo: 'nenhuma', dur: 0.5 };
  ed.clipes.splice(ed.clipes.indexOf(c) + 1, 0, novo);
  salvarEdicao();
  selecionar('c:' + novo.uid);
}
function excluir() {
  const [tipo, u] = (selecionado || '').split(':');
  if (tipo === 'c') ed.clipes = ed.clipes.filter((c) => c.uid !== u);
  else if (tipo === 't') ed.textos = ed.textos.filter((x) => x.uid !== u);
  else if (tipo === 'a') ed.audios = ed.audios.filter((x) => x.uid !== u);
  else if (selecionado === 'musica') ed.musica = null;
  else if (selecionado === 'leg') { if (!confirm('Apagar todas as legendas?')) return; ed.legendas = legendasPadrao(); }
  else return toast('Selecione algo na timeline para excluir.', 'erro');
  salvarEdicao();
  selecionar(null);
}
function duplicar() {
  const [tipo, u] = (selecionado || '').split(':');
  if (tipo === 'c') {
    const c = ed.clipes.find((x) => x.uid === u);
    const n = { ...structuredClone(c), uid: uid() };
    ed.clipes.splice(ed.clipes.indexOf(c) + 1, 0, n);
    salvarEdicao(); return selecionar('c:' + n.uid);
  }
  if (tipo === 't') {
    const t = ed.textos.find((x) => x.uid === u);
    const d = t.fim - t.inicio;
    const n = { ...t, uid: uid(), inicio: t.fim, fim: t.fim + d };
    ed.textos.push(n);
    salvarEdicao(); return selecionar('t:' + n.uid);
  }
  if (tipo === 'a') {
    const x = ed.audios.find((a) => a.uid === u);
    const n = { ...x, uid: uid(), inicio: x.inicio + durAudio(x) };
    ed.audios.push(n);
    salvarEdicao(); return selecionar('a:' + n.uid);
  }
  toast('Selecione um clipe, texto ou áudio para duplicar.', 'erro');
}
function separarAudio() {
  const [tipo, u] = (selecionado || '').split(':');
  const c = tipo === 'c' && ed.clipes.find((x) => x.uid === u);
  const m = c && midiaPorNome(c.midia);
  if (!c || !m || m.tipo !== 'video') return toast('Selecione um clipe de vídeo.', 'erro');
  if (!m.temAudio) return toast('Esse vídeo não tem som.', 'erro');
  if (velC(c) !== 1) return toast('Volte a velocidade do clipe para 1× antes de separar o áudio.', 'erro');
  const it = layoutTL().itens[ed.clipes.indexOf(c)];
  const x = { uid: uid(), midia: c.midia, inicio: +it.inicio.toFixed(3), cortarInicio: c.inicio, duracao: +(c.fim - c.inicio).toFixed(3), volume: c.volume ?? 1, fadeIn: 0, fadeOut: 0 };
  ed.audios.push(x);
  c.mudo = true;
  salvarEdicao();
  selecionar('a:' + x.uid);
  toast('Áudio separado na faixa 🎙 (o clipe ficou mudo).', 'ok');
}
$('#tbDividir').onclick = dividir;
$('#tbExcluir').onclick = excluir;
$('#tbDuplicar').onclick = duplicar;
$('#tbTexto').onclick = adicionarTexto;
$('#tbLegendas').onclick = () => gerarLegendas();
$('#tbDesanexar').onclick = separarAudio;

// ---------- legendas automáticas
function agruparLegendas(palavras, porLegenda = 3) {
  const itens = [];
  let atual = [];
  const fechar = () => { if (atual.length) { itens.push({ inicio: atual[0].inicio, fim: atual.at(-1).fim, texto: atual.map((w) => w.p).join(' '), palavras: atual }); atual = []; } };
  for (const w of palavras) {
    const ant = atual.at(-1);
    if (ant && (w.inicio - ant.fim > 0.45 || atual.length >= porLegenda)) fechar();
    atual.push(w);
    if (/[.!?;:]$/.test(w.p)) fechar();
  }
  fechar();
  return itens;
}
async function gerarLegendas() {
  if (!ed.clipes.length) return toast('Coloque clipes com fala na timeline primeiro.', 'erro');
  if (ed.clipes.some(clipeQuebrado)) return toast('Remova os clipes com arquivo apagado (⚠) antes.', 'erro');
  pausar();
  selecionar('leg');
  const f = formatoPorId(ed.formato);
  const caixa = $('#edExport');
  caixa.hidden = false;
  caixa.innerHTML = '<b>💬 Gerando legendas…</b><div class="barra-prog"><i style="width:5%"></i></div><span class="mono" id="expMsg">juntando o áudio</span>';
  try {
    // nomes dos clipes ajudam o Whisper a acertar marcas e nomes próprios
    const dica = [ed.nome, ...new Set(ed.clipes.map((c) => midiaPorNome(c.midia)?.titulo).filter(Boolean))].join('. ');
    const { job } = await api('/api/edicao/legendas', { corpo: { ...ed, largura: f.largura, altura: f.altura, dica } });
    const fim = await acompanharJob(job.id, (j) => {
      $('#edExport .barra-prog i').style.width = `${Math.round((j.progresso || 0.05) * 100)}%`;
      $('#expMsg').textContent = j.erro || j.ultima || '';
    });
    if (fim.status !== 'ok') throw new Error(fim.erro);
    ed.legendas.palavras = fim.resultado.palavras;
    ed.legendas.itens = agruparLegendas(ed.legendas.palavras, ed.legendas.porLegenda);
    ed.legendas.ativo = true;
    salvarEdicao();
    caixa.hidden = true;
    selecionar('leg');
    toast(`Legendas criadas: ${ed.legendas.itens.length} trechos. Revise o texto no painel da direita.`, 'ok');
  } catch (e) {
    caixa.innerHTML = `<div class="erro-caixa" style="flex:1">Legendas: ${esc(e.message)}</div><button class="btn mini" id="expFechar">×</button>`;
    $('#expFechar').onclick = () => { caixa.hidden = true; };
  }
}

// ---------- palco / pré-visualização
function ajustarPalco() {
  const f = formatoPorId(ed.formato);
  const caixa = $('#palcoCaixa');
  if (!caixa.clientWidth) return;
  const e = Math.min((caixa.clientWidth - 32) / f.largura, (caixa.clientHeight - 32) / f.altura);
  const palco = $('#palco');
  palco.style.width = `${Math.floor(f.largura * e)}px`;
  palco.style.height = `${Math.floor(f.altura * e)}px`;
  palco.classList.toggle('conter', ed.encaixe === 'conter');
}
const player = $('#player');
const playerImg = $('#playerImg');
const cartelaEl = $('#palcoCartela');
const musicaEl = new Audio();
const extrasEl = new Map();
let volumePrevia = 1;
try { volumePrevia = Math.min(1, Math.max(0, +(localStorage.getItem('volumePrevia') ?? 1))); } catch {}
$('#edVolPrevia').value = volumePrevia;
$('#edVolIcone').textContent = volumePrevia === 0 ? '🔇' : '🔊';
$('#edVolPrevia').oninput = (e) => {
  volumePrevia = +e.target.value;
  try { localStorage.setItem('volumePrevia', volumePrevia); } catch {}
  $('#edVolIcone').textContent = volumePrevia === 0 ? '🔇' : '🔊';
};

const FILTROS_CSS = {
  '': '', vivido: 'saturate(1.35) contrast(1.08)', pb: 'grayscale(1) contrast(1.12)', quente: 'sepia(.22) saturate(1.15)',
  frio: 'hue-rotate(-12deg) saturate(.95) brightness(1.02)', vintage: 'sepia(.45) contrast(.9) brightness(1.05)',
  contraste: 'contrast(1.25) saturate(1.1)', desbotado: 'contrast(.85) saturate(.75) brightness(1.03)', cinema: 'contrast(1.2) saturate(.9) hue-rotate(-6deg)',
};
const NOMES_FILTROS = { '': 'Nenhum', vivido: 'Vívido', pb: 'P&B', quente: 'Quente', frio: 'Frio', vintage: 'Vintage', contraste: 'Contraste', desbotado: 'Desbotado', cinema: 'Cinema' };
const cssFiltro = (f = {}) => [FILTROS_CSS[f.preset || ''], f.brilho ? `brightness(${(1 + +f.brilho).toFixed(2)})` : '',
  f.contraste && +f.contraste !== 1 ? `contrast(${f.contraste})` : '', f.saturacao != null && +f.saturacao !== 1 ? `saturate(${f.saturacao})` : ''].filter(Boolean).join(' ');

const prev = { tocando: false, perf0: 0, cab0: 0, clipe: -1 };
let carregandoMidia = null;

function mostrarQuadro() {
  const L = layoutTL();
  const total = L.total;
  const hit = clipeNoTempo(Math.min(cab, Math.max(0, total - 1e-3)));
  $('#palcoVazio').hidden = !!ed.clipes.length;
  if (!hit) {
    player.hidden = true; playerImg.hidden = true; cartelaEl.hidden = true;
    mostrarTexto(null);
  } else {
    const { i, c, it } = hit;
    const local = Math.max(0, cab - it.inicio);
    const m = c.tipo === 'cartela' ? null : midiaPorNome(c.midia);
    $('#palcoMidia').style.filter = cssFiltro(c.filtro);
    // transição: mergulho de opacidade no trecho de sobreposição (o vídeo exportado usa a transição real)
    const xAnt = i > 0 ? L.itens[i - 1].x : 0;
    $('#palcoMidia').style.opacity = xAnt > 0 && local < xAnt ? (0.35 + 0.65 * (local / xAnt)).toFixed(2) : '1';
    if (c.tipo === 'cartela' || !m) {
      player.pause(); player.hidden = true; playerImg.hidden = true;
      cartelaEl.hidden = false;
      cartelaEl.style.background = c.tipo === 'cartela' ? c.cor : 'repeating-linear-gradient(45deg,#3a1d1d 0 12px,#2a1515 12px 24px)';
    } else if (m.tipo === 'imagem') {
      player.pause(); player.hidden = true; cartelaEl.hidden = true;
      playerImg.hidden = false;
      if (!playerImg.src.endsWith(urlMidia(m.nome))) playerImg.src = urlMidia(m.nome);
      const p = it.dur ? local / it.dur : 0;
      playerImg.style.transform = c.zoom === 'aproximar' ? `scale(${1 + 0.18 * p})` : c.zoom === 'afastar' ? `scale(${1.18 - 0.18 * p})` : '';
    } else {
      cartelaEl.hidden = true; playerImg.hidden = true; player.hidden = false;
      const alvo = c.inicio + local * velC(c);
      const url = urlMidia(m.nome);
      if (!player.src.endsWith(url)) { player.src = url; carregandoMidia = url; }
      player.playbackRate = velC(c);
      player.volume = Math.min(1, c.mudo ? 0 : (c.volume ?? 1)) * volumePrevia;
      const posicionar = () => {
        if (prev.tocando) {
          if (prev.clipe !== i || Math.abs(player.currentTime - alvo) > 0.3) player.currentTime = alvo;
          if (player.paused) player.play().catch(() => {});
        } else {
          if (!player.paused) player.pause();
          if (Math.abs(player.currentTime - alvo) > 0.03) player.currentTime = alvo;
        }
      };
      if (player.readyState >= 1) posicionar();
      else player.addEventListener('loadedmetadata', posicionar, { once: true });
    }
    prev.clipe = i;
    mostrarTexto(c.texto?.trim() ? c : null);
  }
  desenharOverlays();
  if (prev.tocando) sincronizarAudios();
  $('#tempoSeq').textContent = `${fmtT(cab)} / ${fmtT(total)}`;
  posicionarCabeca();
}

function mostrarTexto(c) {
  const o = $('#overlayTexto');
  if (!c || !c.texto?.trim()) { o.innerHTML = ''; return; }
  const tam = { p: 3.5, m: 5, g: 7, gg: 9.5 }[c.textoTam || 'm'];
  o.style.fontSize = `${tam}cqh`;
  o.style.color = c.textoCor || '#fff';
  o.style.fontFamily = { impacto: 'Impact, sans-serif', serifa: 'Georgia, serif', normal: 'Arial, sans-serif', negrito: '"Arial Black", Arial, sans-serif' }[c.fonte] || 'Arial';
  o.style.top = c.textoPos === 'topo' ? '8%' : c.textoPos === 'centro' ? '50%' : 'auto';
  o.style.bottom = c.textoPos === 'base' ? '8%' : 'auto';
  o.style.transform = c.textoPos === 'centro' ? 'translateY(-50%)' : 'none';
  o.innerHTML = `<span style="${c.textoFundo ? 'background:rgba(0,0,0,.55)' : ''}">${esc(c.texto.trim())}</span>`;
}

const ESTILOS_TEXTO = {
  contorno: { nome: 'Contorno', css: 'color:#fff;-webkit-text-stroke:.08em #000;paint-order:stroke fill' },
  caixa: { nome: 'Caixa preta', css: 'color:#fff;background:rgba(0,0,0,.75);padding:.1em .35em;border-radius:.12em' },
  amarelo: { nome: 'Amarelo', css: 'color:#ffd400;-webkit-text-stroke:.08em #000;paint-order:stroke fill' },
  neon: { nome: 'Neon', css: 'color:#fff;text-shadow:0 0 .15em #ff2e88,0 0 .35em #ff2e88,0 0 .7em #ff2e88' },
  vermelho: { nome: 'Faixa vermelha', css: 'color:#fff;background:#e11d2e;padding:.1em .35em;border-radius:.12em' },
};
const ESTILOS_LEGENDA = {
  capcut: { nome: 'Destaque amarelo', destaque: '#ffd400', pulo: true },
  verde: { nome: 'Destaque verde', destaque: '#39ff6a', pulo: true },
  caixa: { nome: 'Caixa preta', destaque: '#ffd400', caixa: true },
  karaoke: { nome: 'Karaokê', destaque: '#00e5ff', karaoke: true },
  simples: { nome: 'Simples', destaque: null },
};
const FONTES_CSS = { negrito: '"Arial Black", Arial, sans-serif', impacto: 'Impact, sans-serif', serifa: 'Georgia, serif', normal: 'Arial, sans-serif', moderna: '"Segoe UI Black", "Segoe UI", sans-serif' };
const TAMS_TEXTO = { p: 3.5, m: 5, g: 7, gg: 9.5 };
const topoPorPos = (pos, y) => (pos === 'topo' ? 12 : pos === 'centro' ? 50 : pos === 'livre' ? (y ?? 50) : 80);

function desenharOverlays() {
  // faixa de textos
  const ativos = ed.textos.filter((t) => cab >= t.inicio && cab < t.fim && t.texto?.trim());
  $('#overlayTextos').innerHTML = ativos.map((t) => {
    const e = ESTILOS_TEXTO[t.estilo] || ESTILOS_TEXTO.contorno;
    const ancora = t.pos === 'topo' ? 'translate(-50%,0)' : t.pos === 'base' ? 'translate(-50%,-100%)' : 'translate(-50%,-50%)';
    const p = Math.min(1, (cab - t.inicio) / 0.25);
    const anim = t.anim === 'pop' ? ` scale(${p < 1 ? 0.3 + 0.82 * p : 1})` : t.anim === 'subir' ? ` translateY(${(1 - p) * 30}px)` : '';
    const op = t.anim === 'nenhuma' ? 1 : Math.min(p * 1.5, 1, (t.fim - cab) / 0.2);
    const txt = t.anim === 'digitar' ? t.texto.slice(0, Math.ceil(t.texto.length * Math.min(1, (cab - t.inicio) / ((t.fim - t.inicio) * 0.5)))) : t.texto;
    return `<div class="ov-texto ${selecionado === 't:' + t.uid ? 'sel' : ''}" style="top:${topoPorPos(t.pos, t.y)}%;transform:${ancora}${anim};opacity:${op};font-size:${TAMS_TEXTO[t.tam] || 5}cqh;font-family:${FONTES_CSS[t.fonte] || FONTES_CSS.negrito};${e.css}${t.cor ? `;color:${t.cor}` : ''}">${esc(txt)}</div>`;
  }).join('');
  // legendas
  const L = ed.legendas;
  const item = L?.ativo !== false && L?.itens?.find((it) => cab >= it.inicio && cab < Math.max(it.fim, it.inicio + 0.2));
  const ov = $('#overlayLegenda');
  if (!item) { ov.innerHTML = ''; return; }
  const est = ESTILOS_LEGENDA[L.estilo] || ESTILOS_LEGENDA.capcut;
  const cx = (s) => (L.maiusculas === false ? s : s.toLocaleUpperCase('pt-BR'));
  const palavras = item.palavras?.length ? item.palavras : [{ inicio: item.inicio, fim: item.fim, p: item.texto }];
  let ativa = -1;
  palavras.forEach((w, i) => { if (cab >= w.inicio) ativa = i; });
  ov.style.top = `${topoPorPos(L.pos || 'base')}%`;
  ov.style.transform = L.pos === 'topo' ? 'translate(-50%,0)' : L.pos === 'centro' ? 'translate(-50%,-50%)' : 'translate(-50%,-100%)';
  ov.style.fontSize = `${{ p: 3.8, m: 5, g: 6.4 }[L.tam] || 5}cqh`;
  ov.className = `overlay-legenda ${est.caixa ? 'caixa' : ''}`;
  ov.innerHTML = palavras.map((w, i) => {
    const destaque = est.destaque && (est.karaoke ? i <= ativa : i === ativa);
    return `<span style="${destaque ? `color:${est.destaque};${est.pulo ? 'display:inline-block;transform:scale(1.12)' : ''}` : ''}">${esc(cx(w.p))}</span>`;
  }).join(' ');
}

function sincronizarAudios() {
  const total = totalTimeline();
  if (ed.musica && midiaPorNome(ed.musica.midia)) {
    const url = urlMidia(ed.musica.midia);
    if (!musicaEl.src.endsWith(url)) { musicaEl.src = url; musicaEl.loop = true; }
    musicaEl.volume = Math.min(1, ed.musica.volume ?? 0.5) * volumePrevia;
    const dur = musicaEl.duration || 0;
    const alvo = dur ? cab % dur : cab;
    if (musicaEl.paused) { try { musicaEl.currentTime = alvo; } catch {} musicaEl.play().catch(() => {}); }
    else if (dur && Math.abs(musicaEl.currentTime - alvo) > 0.35) musicaEl.currentTime = alvo;
  } else musicaEl.pause();
  for (const x of ed.audios) {
    if (!midiaPorNome(x.midia)) continue;
    let el = extrasEl.get(x.uid);
    if (!el) { el = new Audio(urlMidia(x.midia)); el.preload = 'auto'; extrasEl.set(x.uid, el); }
    const d = durAudio(x);
    const ativo = cab >= x.inicio && cab < Math.min(x.inicio + d, total);
    el.volume = Math.min(1, x.volume ?? 1) * volumePrevia;
    const alvo = (+x.cortarInicio || 0) + (cab - x.inicio);
    if (ativo && el.paused) { try { el.currentTime = alvo; } catch {} el.play().catch(() => {}); }
    else if (ativo && Math.abs(el.currentTime - alvo) > 0.35) el.currentTime = alvo;
    else if (!ativo && !el.paused) el.pause();
  }
}

function tocar() {
  if (!ed.clipes.length) return toast('A timeline está vazia.', 'erro');
  const total = totalTimeline();
  if (cab >= total - 0.05) cab = 0;
  prev.tocando = true;
  prev.perf0 = performance.now();
  prev.cab0 = cab;
  prev.clipe = -1;
  $('#btnPlay').textContent = '❚❚';
  requestAnimationFrame(passo);
}
function passo() {
  if (!prev.tocando) return;
  const total = totalTimeline();
  cab = prev.cab0 + (performance.now() - prev.perf0) / 1000;
  if (cab >= total) { cab = total; pausar(); mostrarQuadro(); return; }
  mostrarQuadro();
  seguirCabeca();
  requestAnimationFrame(passo);
}
function pausar() {
  prev.tocando = false;
  player.pause();
  musicaEl.pause();
  extrasEl.forEach((el) => el.pause());
  $('#btnPlay').textContent = '▶';
}
const pararSequencia = pausar;
function irParaTempo(t, { seguir = true } = {}) {
  const tocava = prev.tocando;
  if (tocava) pausar();
  cab = Math.max(0, Math.min(t, totalTimeline()));
  mostrarQuadro();
  if (seguir) seguirCabeca();
  if (tocava) tocar();
}
$('#btnPlay').onclick = () => (prev.tocando ? pausar() : tocar());
$('#btnInicio').onclick = () => irParaTempo(0);

// ---------- timeline
const ORIGEM = 89; // largura do rótulo (84) + borda/padding da pista (5)
$('#tlZoom').addEventListener('input', (e) => { pxPorSeg = +e.target.value; desenharTimeline(); });
function posicionarCabeca() {
  $('#tlCabeca').style.left = `${ORIGEM + cab * pxPorSeg}px`;
}
function seguirCabeca() {
  const rol = $('#tlRolagem');
  const x = ORIGEM + cab * pxPorSeg;
  if (x < rol.scrollLeft + ORIGEM + 20 || x > rol.scrollLeft + rol.clientWidth - 40) rol.scrollLeft = Math.max(0, x - ORIGEM - 80);
}

function desenharTimeline() {
  const L = layoutTL();
  const total = L.total;
  const fimAudios = Math.max(0, ...ed.audios.map((x) => x.inicio + durAudio(x)), ...ed.textos.map((t) => t.fim));
  const largura = Math.max(total, fimAudios, 6) * pxPorSeg + 120;

  // régua
  const passoR = pxPorSeg >= 120 ? 0.5 : pxPorSeg >= 60 ? 1 : pxPorSeg >= 30 ? 2 : 5;
  const marcas = [];
  for (let s = 0; s * pxPorSeg < largura; s += passoR) marcas.push(`<i style="left:${s * pxPorSeg}px">${Number.isInteger(s) ? fmtT(s).replace('.0', '') : ''}</i>`);
  $('#tlRegua').innerHTML = marcas.join('');
  $('#tlRegua').style.width = `${largura}px`;
  for (const id of ['#tlClipes', '#tlTextos', '#tlLegendas', '#tlMusica', '#tlAudios']) $(id).style.width = `${largura}px`;

  // vídeo (posições absolutas: mostram a sobreposição das transições)
  $('#tlClipes').innerHTML = ed.clipes.length ? ed.clipes.map((c, i) => {
    const it = L.itens[i];
    const m = midiaPorNome(c.midia);
    const quebrado = clipeQuebrado(c);
    const bg = c.tipo === 'cartela' ? `background:${c.cor}` : m?.thumb ? `background-image:url('/arquivos/miniaturas/${encodeURIComponent(m.thumb)}')` : '';
    const rotulo = c.tipo === 'cartela' ? `🅰 ${c.texto || 'Cartela'}` : quebrado ? '⚠ arquivo apagado' : (m?.titulo || c.midia);
    const marcas = [velC(c) !== 1 ? `${velC(c)}×` : '', c.filtro?.preset ? '🎨' : '', c.texto ? 'T' : '', c.mudo ? '🔇' : (!quebrado && m?.tipo === 'video' && !m.temAudio ? '🔇' : '')].filter(Boolean).join(' ');
    const trans = c.transicao?.tipo && c.transicao.tipo !== 'nenhuma' && ed.clipes[i + 1];
    return `<div class="clipe ${'c:' + c.uid === selecionado ? 'sel' : ''} ${quebrado ? 'quebrado' : ''}" draggable="true" data-uid="${c.uid}" style="left:${it.inicio * pxPorSeg}px;width:${Math.max(16, it.dur * pxPorSeg)}px;${bg}">
      <b class="t">${it.dur.toFixed(1)}s ${marcas}</b><span>${esc(rotulo)}</span>
      <em class="alca esq" data-alca="esq" draggable="false"></em><em class="alca dir" data-alca="dir" draggable="false"></em></div>
      ${ed.clipes[i + 1] ? `<button class="marca-trans ${trans ? 'ativa' : ''}" data-trans="${c.uid}" title="Transição" style="left:${(L.itens[i + 1].inicio + (trans ? it.x / 2 : 0)) * pxPorSeg - 9}px">${trans ? '⧓' : '+'}</button>` : ''}`;
  }).join('') : '<span class="tl-vazio">Arraste vídeos/fotos da Mídia para cá, ou use ＋ Adicionar.</span>';

  // textos
  $('#tlTextos').innerHTML = ed.textos.length ? ed.textos.map((t) => `<div class="bloco bloco-texto ${selecionado === 't:' + t.uid ? 'sel' : ''}" data-texto="${t.uid}" style="left:${t.inicio * pxPorSeg}px;width:${Math.max(18, (t.fim - t.inicio) * pxPorSeg)}px">🅣 ${esc(t.texto)}<em class="alca dir" data-alca="dir"></em></div>`).join('')
    : '<span class="tl-vazio">🅣 Texto (T) adiciona um título no cabeçote.</span>';

  // legendas
  const Lg = ed.legendas;
  $('#tlLegendas').innerHTML = Lg?.itens?.length
    ? Lg.itens.map((it, k) => `<div class="bloco bloco-legenda ${selecionado === 'leg' ? 'sel' : ''} ${Lg.ativo === false ? 'off' : ''}" data-leg="${k}" style="left:${it.inicio * pxPorSeg}px;width:${Math.max(10, (it.fim - it.inicio) * pxPorSeg)}px" title="${esc(it.texto)}">${esc(it.texto)}</div>`).join('')
    : '<span class="tl-vazio">💬 Legendas automáticas: transcreve as falas e anima palavra por palavra.</span>';

  // trilha
  const mus = ed.musica && midiaPorNome(ed.musica.midia);
  $('#tlMusica').innerHTML = ed.musica
    ? `<div class="bloco bloco-musica ${selecionado === 'musica' ? 'sel' : ''}" data-musica style="left:0;width:${Math.max(60, total * pxPorSeg)}px">🎵 ${esc(mus ? (mus.titulo || mus.nome) : '⚠ arquivo apagado')} · ${Math.round((ed.musica.volume ?? 0.5) * 100)}%</div>`
    : '<span class="tl-vazio">Arraste uma música para cá, ou ＋ Adicionar → Trilha sonora.</span>';

  // áudios extras em faixas sem sobreposição
  const faixas = [];
  const blocos = [...ed.audios].sort((a, b) => a.inicio - b.inicio).map((x) => {
    const d = durAudio(x);
    let f = faixas.findIndex((fim) => fim <= x.inicio + 0.01);
    if (f < 0) { f = faixas.length; faixas.push(0); }
    faixas[f] = x.inicio + d;
    const m = midiaPorNome(x.midia);
    return `<div class="bloco bloco-audio ${selecionado === 'a:' + x.uid ? 'sel' : ''}" data-audio="${x.uid}" style="left:${x.inicio * pxPorSeg}px;top:${4 + f * 30}px;width:${Math.max(24, d * pxPorSeg)}px">🎙 ${esc(m ? (m.titulo || m.nome) : '⚠ apagado')}<em class="alca dir" data-alca="dir"></em></div>`;
  });
  const tla = $('#tlAudios');
  tla.style.height = `${Math.max(38, 10 + faixas.length * 30)}px`;
  tla.innerHTML = blocos.length ? blocos.join('') : '<span class="tl-vazio">Locução, efeitos: arraste um áudio para o ponto exato.</span>';

  const quebrados = ed.clipes.filter(clipeQuebrado).length;
  $('#edDuracaoTotal').textContent = ed.clipes.length ? `${ed.clipes.length} clipes · ${fmtT(total)}${quebrados ? ` · ⚠ ${quebrados} com arquivo apagado` : ''}` : '';
  $('#tlCabeca').style.height = `${$('#tlConteiner').scrollHeight}px`;
  if (cab > total) cab = total;
  posicionarCabeca();
  $('#tempoSeq').textContent = `${fmtT(cab)} / ${fmtT(total)}`;
}

// clique na régua / em espaço vazio das pistas: move o cabeçote (arrastando = scrub)
const tempoNoX = (el, clientX) => Math.max(0, (clientX - el.getBoundingClientRect().left - (el.classList.contains('tl-regua') ? 0 : 5)) / pxPorSeg);
function iniciarScrub(el, e) {
  irParaTempo(tempoNoX(el, e.clientX), { seguir: false });
  const mover = (ev) => irParaTempo(tempoNoX(el, ev.clientX), { seguir: false });
  const soltar = () => { document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar); };
  document.addEventListener('mousemove', mover);
  document.addEventListener('mouseup', soltar);
}
$('#tlRegua').addEventListener('mousedown', (e) => iniciarScrub($('#tlRegua'), e));
for (const id of ['#tlClipes', '#tlTextos', '#tlLegendas', '#tlMusica', '#tlAudios']) {
  $(id).addEventListener('mousedown', (e) => { if (e.target === $(id) || e.target.classList.contains('tl-vazio')) iniciarScrub($(id), e); });
}

// seleção
$('#tlClipes').addEventListener('click', (e) => {
  const tr = e.target.closest('[data-trans]');
  if (tr) { abaClipe = 'transicao'; return selecionar('c:' + tr.dataset.trans); }
  const c = e.target.closest('.clipe');
  if (c && !e.target.closest('.alca')) selecionar('c:' + c.dataset.uid);
});
$('#tlTextos').addEventListener('click', (e) => { const b = e.target.closest('[data-texto]'); if (b) selecionar('t:' + b.dataset.texto); });
$('#tlLegendas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-leg]');
  if (!b) return;
  const it = ed.legendas.itens[+b.dataset.leg];
  selecionar('leg');
  if (it) irParaTempo(it.inicio + 0.01);
  setTimeout(() => $(`#legItem${b.dataset.leg}`)?.scrollIntoView({ block: 'center' }), 30);
});
$('#tlMusica').addEventListener('click', (e) => { if (e.target.closest('[data-musica]')) selecionar('musica'); });
$('#tlAudios').addEventListener('click', (e) => { const b = e.target.closest('[data-audio]'); if (b && !e.target.closest('.alca')) selecionar('a:' + b.dataset.audio); });

// arrastar com o mouse: mover textos/áudios e aparar clipes/textos/áudios pelas alças
document.addEventListener('mousedown', (e) => {
  const alca = e.target.closest('.alca');
  const bloco = e.target.closest('.bloco-texto, .bloco-audio');
  if (!alca && !bloco) return;
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX;
  const el = alca ? alca.parentElement : bloco;
  let alvo; let tipo;
  if (el.classList.contains('clipe')) { alvo = ed.clipes.find((c) => c.uid === el.dataset.uid); tipo = 'clipe'; selecionado = 'c:' + alvo.uid; }
  else if (el.dataset.texto) { alvo = ed.textos.find((t) => t.uid === el.dataset.texto); tipo = 'texto'; selecionado = 't:' + alvo.uid; }
  else { alvo = ed.audios.find((a) => a.uid === el.dataset.audio); tipo = 'audio'; selecionado = 'a:' + alvo.uid; }
  const orig = structuredClone(alvo);
  const lado = alca?.dataset.alca;
  const m = alvo.midia && midiaPorNome(alvo.midia);
  let mexeu = false;
  const mover = (ev) => {
    const dt = (ev.clientX - x0) / pxPorSeg;
    if (Math.abs(ev.clientX - x0) > 2) mexeu = true;
    if (tipo === 'clipe') {
      if (ehFixo(alvo)) { if (lado === 'dir') alvo.duracaoImagem = Math.max(0.2, +(orig.duracaoImagem + dt).toFixed(2)); }
      else if (lado === 'dir') alvo.fim = Math.min(m?.duracao || 1e9, Math.max(orig.inicio + 0.1, +(orig.fim + dt * velC(orig)).toFixed(3)));
      else alvo.inicio = Math.max(0, Math.min(orig.fim - 0.1, +(orig.inicio + dt * velC(orig)).toFixed(3)));
    } else if (tipo === 'texto') {
      if (lado === 'dir') alvo.fim = Math.max(orig.inicio + 0.2, +(orig.fim + dt).toFixed(2));
      else { const d = orig.fim - orig.inicio; alvo.inicio = Math.max(0, +(orig.inicio + dt).toFixed(2)); alvo.fim = +(alvo.inicio + d).toFixed(2); }
    } else if (lado === 'dir') {
      alvo.duracao = Math.max(0.1, +(durAudio(orig) + dt).toFixed(2));
    } else alvo.inicio = Math.max(0, +(orig.inicio + dt).toFixed(2));
    desenharTimeline();
    mostrarQuadro();
  };
  const soltar = () => {
    document.removeEventListener('mousemove', mover);
    document.removeEventListener('mouseup', soltar);
    if (mexeu) salvarEdicao();
    selecionar(selecionado);
  };
  document.addEventListener('mousemove', mover);
  document.addEventListener('mouseup', soltar);
}, true);

// arrastar e soltar: reordenar clipes / mídia da coluna / arquivos do computador
let arrastandoUid = null;
$('#tlClipes').addEventListener('dragstart', (e) => {
  const c = e.target.closest('.clipe');
  if (!c) return;
  arrastandoUid = c.dataset.uid;
  c.classList.add('arrastando');
  e.dataTransfer.effectAllowed = 'move';
});
function posicaoPorTempo(t) {
  const L = layoutTL();
  for (let i = 0; i < L.itens.length; i++) if (t < L.itens[i].inicio + L.itens[i].dur / 2) return i;
  return ed.clipes.length;
}
for (const id of ['#tlClipes', '#tlTextos', '#tlMusica', '#tlAudios']) {
  const el = $(id);
  el.addEventListener('dragover', (e) => {
    const t = e.dataTransfer.types;
    if (!(arrastandoUid && id === '#tlClipes') && !t.includes('text/x-midia') && !t.includes('Files')) return;
    e.preventDefault();
    el.classList.add('soltar');
  });
  el.addEventListener('dragleave', () => el.classList.remove('soltar'));
  el.addEventListener('drop', async (e) => {
    el.classList.remove('soltar');
    const tempo = tempoNoX(el, e.clientX);
    if (id === '#tlClipes' && arrastandoUid) {
      e.preventDefault();
      const de = ed.clipes.findIndex((c) => c.uid === arrastandoUid);
      const [item] = ed.clipes.splice(de, 1);
      ed.clipes.splice(Math.min(posicaoPorTempo(tempo), ed.clipes.length), 0, item);
      arrastandoUid = null;
      salvarEdicao();
      return selecionar('c:' + item.uid);
    }
    let nomes = [];
    if (e.dataTransfer.types.includes('text/x-midia')) nomes = [e.dataTransfer.getData('text/x-midia')];
    else if (e.dataTransfer.files.length) { e.preventDefault(); nomes = (await enviarArquivos([...e.dataTransfer.files])).map((i) => i.nome); }
    e.preventDefault();
    for (const nome of nomes) {
      const m = midiaPorNome(nome);
      if (!m) continue;
      if (id === '#tlMusica') { if (m.tipo === 'imagem') toast('Solte um áudio na trilha.', 'erro'); else definirTrilha(nome); }
      else if (id === '#tlAudios') { if (m.tipo === 'imagem') toast('Solte um áudio aqui.', 'erro'); else adicionarAudio(nome, tempo); }
      else if (m.tipo === 'audio') adicionarAudio(nome, tempo);
      else adicionarClipe(nome, { posicao: posicaoPorTempo(tempo) });
    }
  });
}
$('#tlClipes').addEventListener('dragend', () => { arrastandoUid = null; desenharTimeline(); });

// ---------- atalhos de teclado (como nos editores)
document.addEventListener('keydown', (e) => {
  if (estado.vista !== 'editor' || !$('#modal').hidden) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'z' && !e.shiftKey) { e.preventDefault(); restaurarHist(-1); }
  else if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); restaurarHist(1); }
  else if (e.ctrlKey && k === 'd') { e.preventDefault(); duplicar(); }
  else if (k === ' ') { e.preventDefault(); prev.tocando ? pausar() : tocar(); }
  else if (k === 's' && !e.ctrlKey) { e.preventDefault(); dividir(); }
  else if (k === 't' && !e.ctrlKey) { e.preventDefault(); adicionarTexto(); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); excluir(); }
  else if (k === 'arrowleft') { e.preventDefault(); irParaTempo(cab - (e.shiftKey ? 1 : quadro())); }
  else if (k === 'arrowright') { e.preventDefault(); irParaTempo(cab + (e.shiftKey ? 1 : quadro())); }
  else if (k === 'home') { e.preventDefault(); irParaTempo(0); }
  else if (k === 'end') { e.preventDefault(); irParaTempo(totalTimeline()); }
});

// ---------- inspetor
function selecionar(id) {
  if (id && !id.includes(':') && id !== 'musica' && id !== 'leg' && ed.clipes.some((c) => c.uid === id)) id = 'c:' + id;
  selecionado = id;
  desenharTimeline();
  mostrarQuadro();
  const ins = $('#inspetor');
  if (!id || !existe(id)) {
    ins.innerHTML = `<p class="vazio">Selecione um item na timeline para editar.<br><br>
      <b>Dicas</b><br>• Clique na régua para mover o cabeçote (linha laranja).<br>• Arraste as bordas dos clipes para cortar.<br>
      • Arraste textos e áudios para mudar quando entram.<br>• <b>S</b> divide no cabeçote · <b>Espaço</b> toca · <b>Ctrl+Z</b> desfaz.</p>`;
    return;
  }
  if (id === 'musica') return inspetorMusica(ins);
  if (id === 'leg') return inspetorLegendas(ins);
  const [tipo, u] = id.split(':');
  if (tipo === 'a') return inspetorAudio(ins, ed.audios.find((x) => x.uid === u));
  if (tipo === 't') return inspetorTexto(ins, ed.textos.find((x) => x.uid === u));
  return inspetorClipe(ins, ed.clipes.find((x) => x.uid === u));
}
const ligar = (sel, ev, fn) => { const el = $(sel); if (el) el[ev] = fn; };
const mudou = () => { salvarEdicao(); desenharTimeline(); mostrarQuadro(); };

function inspetorMusica(ins) {
  const m = midiaPorNome(ed.musica.midia);
  ins.innerHTML = `<h3>🎵 Trilha sonora</h3>
    <b class="nome-arq">${esc(m?.titulo || ed.musica.midia)}</b>
    ${m ? `<audio controls src="${urlMidia(m.nome)}" class="mini-audio"></audio>` : '<p class="erro-caixa">O arquivo desta trilha foi apagado.</p>'}
    <label>Volume <span class="mono" id="iVolTxt">${Math.round(ed.musica.volume * 100)}%</span><input type="range" id="iMusVol" min="0" max="1.5" step="0.05" value="${ed.musica.volume}"></label>
    <div class="corte">
      <label>Fade in (s)<input type="number" id="iMusFadeIn" min="0" max="10" step="0.5" value="${ed.musica.fadeIn ?? 0}"></label>
      <label>Fade out (s)<input type="number" id="iMusFade" min="0" max="10" step="0.5" value="${ed.musica.fadeOut}"></label>
    </div>
    <p class="ajuda">Toca do início ao fim (repete se for curta), mixada com o som dos clipes e os áudios extras.</p>
    <button class="btn" id="iMusTrocar">Trocar arquivo…</button>
    <button class="btn perigo" id="iMusRem">Remover trilha</button>`;
  ligar('#iMusVol', 'oninput', (e) => { ed.musica.volume = +e.target.value; $('#iVolTxt').textContent = Math.round(e.target.value * 100) + '%'; mudou(); });
  ligar('#iMusFadeIn', 'onchange', (e) => { ed.musica.fadeIn = +e.target.value; salvarEdicao(); });
  ligar('#iMusFade', 'onchange', (e) => { ed.musica.fadeOut = +e.target.value; salvarEdicao(); });
  ligar('#iMusTrocar', 'onclick', () => $('#upTrilha').click());
  ligar('#iMusRem', 'onclick', () => { ed.musica = null; salvarEdicao(); selecionar(null); });
}

function inspetorAudio(ins, x) {
  const m = midiaPorNome(x.midia);
  const id = 'a:' + x.uid;
  ins.innerHTML = `<h3>🎙 Áudio extra</h3>
    <b class="nome-arq">${esc(m?.titulo || x.midia)}</b>
    ${m ? `<audio controls src="${urlMidia(m.nome)}" class="mini-audio" id="iAudPlayer"></audio>` : '<p class="erro-caixa">O arquivo deste áudio foi apagado.</p>'}
    <div class="corte">
      <label>Entra em (s)<input type="number" id="iAudIni" min="0" step="0.05" value="${x.inicio}"></label>
      <button class="btn mini" id="iAudCab" style="align-self:end">⇥ no cabeçote</button>
      <label>Cortar começo (s)<input type="number" id="iAudCorte" min="0" step="0.05" value="${x.cortarInicio || 0}"></label>
      <label>Duração (0 = tudo)<input type="number" id="iAudDur" min="0" step="0.1" value="${x.duracao || 0}"></label>
      <label>Fade in (s)<input type="number" id="iAudFi" min="0" max="5" step="0.1" value="${x.fadeIn || 0}"></label>
      <label>Fade out (s)<input type="number" id="iAudFo" min="0" max="5" step="0.1" value="${x.fadeOut || 0}"></label>
    </div>
    <label>Volume <span class="mono" id="iAudVolTxt">${Math.round((x.volume ?? 1) * 100)}%</span><input type="range" id="iAudVol" min="0" max="1.5" step="0.05" value="${x.volume ?? 1}"></label>
    <p class="ajuda" style="margin:0">Toca de ${x.inicio.toFixed(2)}s a ${(x.inicio + durAudio(x)).toFixed(2)}s. Arraste o bloco 🎙 para mover; arraste a borda direita para encurtar.</p>
    <button class="btn mini" id="iAudCorteAgora">✂ cortar o começo onde o player acima está</button>`;
  const num = (v) => Math.max(0, +v || 0);
  ligar('#iAudIni', 'onchange', (e) => { x.inicio = num(e.target.value); mudou(); selecionar(id); });
  ligar('#iAudCab', 'onclick', () => { x.inicio = +cab.toFixed(2); mudou(); selecionar(id); });
  ligar('#iAudCorte', 'onchange', (e) => { x.cortarInicio = num(e.target.value); mudou(); selecionar(id); });
  ligar('#iAudDur', 'onchange', (e) => { x.duracao = num(e.target.value); mudou(); selecionar(id); });
  ligar('#iAudFi', 'onchange', (e) => { x.fadeIn = num(e.target.value); salvarEdicao(); });
  ligar('#iAudFo', 'onchange', (e) => { x.fadeOut = num(e.target.value); salvarEdicao(); });
  ligar('#iAudVol', 'oninput', (e) => { x.volume = +e.target.value; $('#iAudVolTxt').textContent = Math.round(x.volume * 100) + '%'; salvarEdicao(); });
  ligar('#iAudCorteAgora', 'onclick', () => { const p = $('#iAudPlayer'); if (p) { x.cortarInicio = +p.currentTime.toFixed(2); mudou(); selecionar(id); } });
}

function inspetorTexto(ins, t) {
  const id = 't:' + t.uid;
  ins.innerHTML = `<h3>🅣 Texto</h3>
    <textarea id="xTexto" rows="2">${esc(t.texto)}</textarea>
    <div class="corte">
      <label>Entra em (s)<input type="number" id="xIni" min="0" step="0.05" value="${t.inicio}"></label>
      <label>Sai em (s)<input type="number" id="xFim" min="0" step="0.05" value="${t.fim}"></label>
      <button class="btn mini" id="xIniCab">⇥ entrar no cabeçote</button>
      <button class="btn mini" id="xFimCab">sair no cabeçote ⇤</button>
    </div>
    <h3>Estilo</h3>
    <div class="grade-estilos">${Object.entries(ESTILOS_TEXTO).map(([k, e]) => `<button class="estilo-btn ${t.estilo === k ? 'ativa' : ''}" data-estilo="${k}"><span style="${e.css};font-family:${FONTES_CSS.negrito}">Aa</span>${e.nome}</button>`).join('')}</div>
    <div class="corte">
      <label>Fonte<select id="xFonte">${Object.entries({ negrito: 'Arial Black', impacto: 'Impact', moderna: 'Segoe UI Black', serifa: 'Georgia', normal: 'Arial' }).map(([k, v]) => `<option value="${k}" ${t.fonte === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Cor (opcional)<input type="color" id="xCor" value="${t.cor || '#ffffff'}"></label>
      <label>Tamanho<select id="xTam">${Object.entries({ p: 'Pequeno', m: 'Médio', g: 'Grande', gg: 'Gigante' }).map(([k, v]) => `<option value="${k}" ${t.tam === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Posição<select id="xPos">${Object.entries({ topo: 'Topo', centro: 'Centro', base: 'Base', livre: 'Livre (altura)' }).map(([k, v]) => `<option value="${k}" ${t.pos === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label id="xYLinha" ${t.pos === 'livre' ? '' : 'hidden'}>Altura na tela: <span class="mono" id="xYTxt">${t.y ?? 50}%</span><input type="range" id="xY" min="5" max="95" value="${t.y ?? 50}"></label>
    <h3>Animação de entrada</h3>
    <div class="chips pequenos" id="xAnim">${Object.entries({ nenhuma: 'Nenhuma', fade: 'Fade', pop: 'Pop', subir: 'Subir', digitar: 'Digitar' }).map(([k, v]) => `<button data-anim="${k}" class="${(t.anim || 'fade') === k ? 'ativa' : ''}">${v}</button>`).join('')}</div>
    <button class="btn mini" id="xLimparCor">Usar a cor do estilo</button>`;
  ligar('#xTexto', 'oninput', (e) => { t.texto = e.target.value; mudou(); });
  ligar('#xIni', 'onchange', (e) => { const d = t.fim - t.inicio; t.inicio = Math.max(0, +e.target.value || 0); if (t.fim <= t.inicio) t.fim = t.inicio + d; mudou(); selecionar(id); });
  ligar('#xFim', 'onchange', (e) => { t.fim = Math.max(t.inicio + 0.2, +e.target.value || 0); mudou(); selecionar(id); });
  ligar('#xIniCab', 'onclick', () => { const d = t.fim - t.inicio; t.inicio = +cab.toFixed(2); t.fim = +(t.inicio + d).toFixed(2); mudou(); selecionar(id); });
  ligar('#xFimCab', 'onclick', () => { if (cab <= t.inicio) return toast('O cabeçote está antes do começo do texto.', 'erro'); t.fim = +cab.toFixed(2); mudou(); selecionar(id); });
  $$('.estilo-btn', ins).forEach((b) => b.onclick = () => { t.estilo = b.dataset.estilo; mudou(); selecionar(id); });
  ligar('#xFonte', 'onchange', (e) => { t.fonte = e.target.value; mudou(); });
  ligar('#xCor', 'oninput', (e) => { t.cor = e.target.value; mudou(); });
  ligar('#xLimparCor', 'onclick', () => { t.cor = ''; mudou(); selecionar(id); });
  ligar('#xTam', 'onchange', (e) => { t.tam = e.target.value; mudou(); });
  ligar('#xPos', 'onchange', (e) => { t.pos = e.target.value; $('#xYLinha').hidden = t.pos !== 'livre'; mudou(); });
  ligar('#xY', 'oninput', (e) => { t.y = +e.target.value; $('#xYTxt').textContent = t.y + '%'; mudou(); });
  $$('#xAnim button', ins).forEach((b) => b.onclick = () => { t.anim = b.dataset.anim; $$('#xAnim button').forEach((x) => x.classList.toggle('ativa', x === b)); irParaTempo(t.inicio); salvarEdicao(); });
}

function inspetorLegendas(ins) {
  const L = ed.legendas;
  ins.innerHTML = `<h3>💬 Legendas</h3>
    <button class="btn primario" id="lGerar">✦ ${L.itens.length ? 'Gerar de novo (transcrever)' : 'Gerar legendas automáticas'}</button>
    <p class="ajuda" style="margin:0">Transcreve as falas da edição (offline, Whisper) e anima palavra por palavra. A trilha não entra na transcrição.</p>
    ${L.itens.length ? `
    <label class="check"><input type="checkbox" id="lAtivo" ${L.ativo !== false ? 'checked' : ''}> mostrar legendas no vídeo</label>
    <h3>Estilo</h3>
    <div class="grade-estilos">${Object.entries(ESTILOS_LEGENDA).map(([k, e]) => `<button class="estilo-btn ${L.estilo === k ? 'ativa' : ''}" data-est="${k}"><span class="leg-amostra ${e.caixa ? 'caixa' : ''}">OI <i style="color:${e.destaque || '#fff'}">VOCÊ</i></span>${e.nome}</button>`).join('')}</div>
    <div class="corte">
      <label>Tamanho<select id="lTam">${Object.entries({ p: 'Pequeno', m: 'Médio', g: 'Grande' }).map(([k, v]) => `<option value="${k}" ${L.tam === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Posição<select id="lPos">${Object.entries({ base: 'Base', centro: 'Centro', topo: 'Topo' }).map(([k, v]) => `<option value="${k}" ${L.pos === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Palavras por vez<select id="lPor">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${+L.porLegenda === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="check" style="align-self:end"><input type="checkbox" id="lMai" ${L.maiusculas !== false ? 'checked' : ''}> MAIÚSCULAS</label>
    </div>
    <h3>Texto (${L.itens.length} trechos) — clique no tempo para ir até ele</h3>
    <div class="lista-legendas">${L.itens.map((it, k) => `<div class="leg-item" id="legItem${k}">
      <button class="mono" data-ir="${k}">${it.inicio.toFixed(1)}s</button>
      <input value="${esc(it.texto)}" data-leg="${k}">
      <button class="btn mini perigo" data-rem="${k}" title="Apagar trecho">✕</button></div>`).join('')}</div>` : ''}`;
  ligar('#lGerar', 'onclick', () => gerarLegendas());
  if (!L.itens.length) return;
  ligar('#lAtivo', 'onchange', (e) => { L.ativo = e.target.checked; mudou(); });
  $$('.estilo-btn', ins).forEach((b) => b.onclick = () => { L.estilo = b.dataset.est; mudou(); selecionar('leg'); });
  ligar('#lTam', 'onchange', (e) => { L.tam = e.target.value; mudou(); });
  ligar('#lPos', 'onchange', (e) => { L.pos = e.target.value; mudou(); });
  ligar('#lMai', 'onchange', (e) => { L.maiusculas = e.target.checked; mudou(); });
  ligar('#lPor', 'onchange', (e) => {
    if (!L.palavras?.length) return;
    if (L.itens.some((it) => it.editado) && !confirm('Reagrupar desfaz as correções de texto que você fez nos trechos. Continuar?')) { e.target.value = L.porLegenda; return; }
    L.porLegenda = +e.target.value;
    L.itens = agruparLegendas(L.palavras, L.porLegenda);
    mudou(); selecionar('leg');
  });
  $('.lista-legendas', ins).addEventListener('change', (e) => {
    const k = e.target.dataset.leg;
    if (k == null) return;
    const it = L.itens[+k];
    const novas = e.target.value.trim().split(/\s+/).filter(Boolean);
    // redistribui o tempo do trecho entre as palavras corrigidas
    const passo = (it.fim - it.inicio) / Math.max(1, novas.length);
    it.palavras = novas.map((p, i) => ({ p, inicio: +(it.inicio + i * passo).toFixed(3), fim: +(it.inicio + (i + 1) * passo).toFixed(3) }));
    it.texto = novas.join(' ');
    it.editado = true;
    mudou();
  });
  $('.lista-legendas', ins).addEventListener('click', (e) => {
    const ir = e.target.closest('[data-ir]');
    if (ir) return irParaTempo(L.itens[+ir.dataset.ir].inicio + 0.01);
    const rem = e.target.closest('[data-rem]');
    if (rem) { L.itens.splice(+rem.dataset.rem, 1); mudou(); selecionar('leg'); }
  });
}

function inspetorClipe(ins, c) {
  const i = ed.clipes.indexOf(c);
  const id = 'c:' + c.uid;
  const m = c.tipo === 'cartela' ? null : midiaPorNome(c.midia);
  if (clipeQuebrado(c)) {
    ins.innerHTML = `<h3>Clipe ${i + 1}</h3><div class="erro-caixa">O arquivo deste clipe (${esc(c.midia)}) foi apagado da Mídia. Remova-o.</div>
      <button class="btn perigo" id="iRem">Remover da timeline</button>`;
    ligar('#iRem', 'onclick', () => { ed.clipes = ed.clipes.filter((x) => x !== c); salvarEdicao(); selecionar(null); });
    return;
  }
  const fixoC = ehFixo(c);
  const it = layoutTL().itens[i];
  c.filtro ||= { preset: '', brilho: 0, contraste: 1, saturacao: 1 };
  c.transicao ||= { tipo: 'nenhuma', dur: 0.5 };
  const abas = [['editar', 'Editar'], ...(fixoC ? [] : [['velocidade', 'Velocidade']]), ['filtros', 'Filtros'], ['transicao', 'Transição'], ['texto', 'Texto']];
  if (!abas.some(([k]) => k === abaClipe)) abaClipe = 'editar';
  let corpo = '';
  if (abaClipe === 'editar') {
    corpo = `${c.tipo === 'cartela' ? `<label>Cor de fundo<input type="color" id="iCorFundo" value="${c.cor}"></label>` : `<b class="nome-arq">${esc(m?.titulo || c.midia)}</b>`}
      ${fixoC ? `<label>Duração na tela (s)<input type="number" id="iDurImg" min="0.2" step="0.1" value="${c.duracaoImagem}"></label>
        <label>Movimento (Ken Burns)<select id="iZoom">${Object.entries({ nenhum: 'Parado', aproximar: 'Zoom aproximando', afastar: 'Zoom afastando' }).map(([k, v]) => `<option value="${k}" ${(c.zoom || 'nenhum') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : `
      <div class="corte">
        <label>Início no arquivo (s)<input type="number" id="iIni" min="0" step="0.05" value="${c.inicio.toFixed(2)}"></label>
        <label>Fim no arquivo (s)<input type="number" id="iFim" min="0" step="0.05" value="${c.fim.toFixed(2)}"></label>
        <button class="btn mini" id="iCortarIni" title="Corta o começo do clipe até o cabeçote">✂ cortar começo no cabeçote</button>
        <button class="btn mini" id="iCortarFim" title="Corta o fim do clipe a partir do cabeçote">✂ cortar fim no cabeçote</button>
      </div>
      <p class="ajuda" style="margin:0">Arquivo com ${m?.duracao?.toFixed(2)}s · na timeline: ${it.dur.toFixed(2)}s. Dica: arraste as bordas do clipe na timeline.</p>
      ${m?.temAudio ? `<label>Volume <span class="mono" id="iVolTxt">${Math.round((c.volume ?? 1) * 100)}%</span><input type="range" id="iVol" min="0" max="2" step="0.05" value="${c.volume ?? 1}"></label>
        <label class="check"><input type="checkbox" id="iMudo" ${c.mudo ? 'checked' : ''}> silenciar o som deste clipe</label>
        <button class="btn mini" id="iSeparar">🔊 Separar o áudio numa faixa própria</button>`
        : '<p class="aviso" style="margin:0">🔇 Este vídeo não tem som próprio. Use trilha, áudio extra ou renderize o projeto com voz/efeitos.</p>'}`}
      <div class="corte">
        <label>Fade in (s)<input type="number" id="iFadeIn" min="0" max="3" step="0.1" value="${c.fadeIn || 0}"></label>
        <label>Fade out (s)<input type="number" id="iFadeOut" min="0" max="3" step="0.1" value="${c.fadeOut || 0}"></label>
      </div>
      <div class="corte">
        <button class="btn mini" id="iEsq">← mover</button><button class="btn mini" id="iDir">mover →</button>
        <button class="btn mini" id="iCartelaDepois" style="grid-column:1/-1">🅰 Inserir cartela depois deste</button>
      </div>`;
  } else if (abaClipe === 'velocidade') {
    corpo = `<p class="ajuda" style="margin:0">Duração na timeline: <b>${it.dur.toFixed(2)}s</b> (original ${(c.fim - c.inicio).toFixed(2)}s). O tom da voz é preservado.</p>
      <div class="chips pequenos" id="iVelPresets">${[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((v) => `<button data-v="${v}" class="${velC(c) === v ? 'ativa' : ''}">${v}×</button>`).join('')}</div>
      <label>Velocidade: <span class="mono" id="iVelTxt">${velC(c)}×</span><input type="range" id="iVel" min="0.25" max="4" step="0.05" value="${velC(c)}"></label>`;
  } else if (abaClipe === 'filtros') {
    const thumb = c.tipo === 'cartela' ? '' : m?.thumb ? `url('/arquivos/miniaturas/${encodeURIComponent(m.thumb)}')` : '';
    corpo = `<div class="grade-filtros">${Object.keys(FILTROS_CSS).map((k) => `<button class="filtro-btn ${(c.filtro.preset || '') === k ? 'ativa' : ''}" data-f="${k}">
        <i style="background:${thumb || c.cor || '#555'} center/cover;filter:${FILTROS_CSS[k] || 'none'}"></i>${NOMES_FILTROS[k]}</button>`).join('')}</div>
      <h3>Ajustes</h3>
      <label>Brilho <span class="mono" id="iBrTxt">${(+c.filtro.brilho || 0).toFixed(2)}</span><input type="range" id="iBr" min="-0.4" max="0.4" step="0.02" value="${c.filtro.brilho || 0}"></label>
      <label>Contraste <span class="mono" id="iCoTxt">${(+c.filtro.contraste || 1).toFixed(2)}</span><input type="range" id="iCo" min="0.5" max="1.8" step="0.02" value="${c.filtro.contraste ?? 1}"></label>
      <label>Saturação <span class="mono" id="iSaTxt">${(+(c.filtro.saturacao ?? 1)).toFixed(2)}</span><input type="range" id="iSa" min="0" max="2" step="0.02" value="${c.filtro.saturacao ?? 1}"></label>
      <button class="btn mini" id="iFiltroZerar">Zerar ajustes</button>
      <button class="btn mini" id="iFiltroTodos">Aplicar este filtro em todos os clipes</button>`;
  } else if (abaClipe === 'transicao') {
    const prox = ed.clipes[i + 1];
    const TR = { nenhuma: 'Corte seco', fade: 'Dissolver', fadeblack: 'Pelo preto', fadewhite: 'Flash branco', slideleft: 'Deslizar ←', slideup: 'Deslizar ↑', wipeleft: 'Cortina ←', circleopen: 'Círculo', zoomin: 'Zoom', smoothleft: 'Suave ←', radial: 'Radial', pixelize: 'Pixelar', hblur: 'Desfoque', coverleft: 'Cobrir ←', dissolve: 'Granulado' };
    corpo = prox ? `<p class="ajuda" style="margin:0">Transição deste clipe para o <b>clipe ${i + 2}</b>.</p>
      <div class="grade-trans">${Object.entries(TR).map(([k, v]) => `<button class="trans-btn ${(c.transicao.tipo || 'nenhuma') === k ? 'ativa' : ''}" data-t="${k}">${v}</button>`).join('')}</div>
      <label>Duração: <span class="mono" id="iTrTxt">${(+c.transicao.dur || 0.5).toFixed(1)}s</span><input type="range" id="iTrDur" min="0.2" max="1.5" step="0.1" value="${c.transicao.dur || 0.5}"></label>
      <button class="btn mini" id="iTrTodos">Usar esta transição entre todos os clipes</button>
      <p class="ajuda" style="margin:0">Na pré-visualização a transição aparece como um esmaecer; no MP4 exportado sai a transição escolhida.</p>`
      : '<p class="ajuda">Este é o último clipe — a transição fica entre um clipe e o próximo.</p>';
  } else {
    corpo = `<p class="ajuda" style="margin:0">Texto preso a este clipe. Para textos com tempo livre, use a faixa 🅣 Textos (tecla T).</p>
      <textarea id="iTexto" rows="2" placeholder="Ex.: 30g de proteína por dose">${esc(c.texto || '')}</textarea>
      <div class="corte">
        <label>Posição<select id="iPos"><option value="topo">Topo</option><option value="centro">Centro</option><option value="base">Base</option></select></label>
        <label>Tamanho<select id="iTam"><option value="p">Pequeno</option><option value="m">Médio</option><option value="g">Grande</option><option value="gg">Gigante</option></select></label>
        <label>Fonte<select id="iFonte"><option value="negrito">Arial Black</option><option value="impacto">Impact</option><option value="serifa">Georgia</option><option value="normal">Arial</option></select></label>
        <label>Cor<input type="color" id="iCor" value="${c.textoCor || '#ffffff'}"></label>
      </div>
      <label class="check"><input type="checkbox" id="iFundo" ${c.textoFundo ? 'checked' : ''}> caixa escura atrás</label>`;
  }
  ins.innerHTML = `<h3>${c.tipo === 'cartela' ? '🅰 Cartela' : '🎬 Clipe'} ${i + 1} de ${ed.clipes.length}</h3>
    <div class="abas-insp">${abas.map(([k, v]) => `<button data-aba="${k}" class="${abaClipe === k ? 'ativa' : ''}">${v}</button>`).join('')}</div>
    ${corpo}`;
  $$('.abas-insp button', ins).forEach((b) => b.onclick = () => { abaClipe = b.dataset.aba; selecionar(id); });
  const num = (v) => Math.max(0, +v || 0);
  // editar
  ligar('#iCorFundo', 'oninput', (e) => { c.cor = e.target.value; mudou(); });
  ligar('#iDurImg', 'onchange', (e) => { c.duracaoImagem = Math.max(0.2, +e.target.value || 3); mudou(); selecionar(id); });
  ligar('#iZoom', 'onchange', (e) => { c.zoom = e.target.value; mudou(); });
  const limitar = () => {
    c.inicio = Math.min(Math.max(0, c.inicio), (m?.duracao || 1e9) - 0.1);
    c.fim = Math.max(c.inicio + 0.1, Math.min(c.fim, m?.duracao || 1e9));
    mudou(); selecionar(id);
  };
  ligar('#iIni', 'onchange', (e) => { c.inicio = num(e.target.value); limitar(); });
  ligar('#iFim', 'onchange', (e) => { c.fim = num(e.target.value); limitar(); });
  const tempoNoArquivo = () => { const L = layoutTL(); const local = cab - L.itens[i].inicio; return local > 0 && local < L.itens[i].dur ? c.inicio + local * velC(c) : null; };
  ligar('#iCortarIni', 'onclick', () => { const t = tempoNoArquivo(); if (t == null) return toast('Coloque o cabeçote dentro deste clipe.', 'erro'); c.inicio = +t.toFixed(3); limitar(); });
  ligar('#iCortarFim', 'onclick', () => { const t = tempoNoArquivo(); if (t == null) return toast('Coloque o cabeçote dentro deste clipe.', 'erro'); c.fim = +t.toFixed(3); limitar(); });
  ligar('#iVol', 'oninput', (e) => { c.volume = +e.target.value; $('#iVolTxt').textContent = Math.round(c.volume * 100) + '%'; salvarEdicao(); });
  ligar('#iMudo', 'onchange', (e) => { c.mudo = e.target.checked; mudou(); });
  ligar('#iSeparar', 'onclick', separarAudio);
  ligar('#iFadeIn', 'onchange', (e) => { c.fadeIn = num(e.target.value); salvarEdicao(); });
  ligar('#iFadeOut', 'onchange', (e) => { c.fadeOut = num(e.target.value); salvarEdicao(); });
  const mover = (d) => { const j = i + d; if (j < 0 || j >= ed.clipes.length) return; [ed.clipes[i], ed.clipes[j]] = [ed.clipes[j], ed.clipes[i]]; salvarEdicao(); selecionar(id); };
  ligar('#iEsq', 'onclick', () => mover(-1));
  ligar('#iDir', 'onclick', () => mover(1));
  ligar('#iCartelaDepois', 'onclick', () => adicionarCartela(i + 1));
  // velocidade
  const setVel = (v) => { c.velocidade = Math.min(4, Math.max(0.25, +v)); mudou(); selecionar(id); };
  $$('#iVelPresets button', ins).forEach((b) => b.onclick = () => setVel(b.dataset.v));
  ligar('#iVel', 'onchange', (e) => setVel(e.target.value));
  ligar('#iVel', 'oninput', (e) => { $('#iVelTxt').textContent = (+e.target.value).toFixed(2) + '×'; });
  // filtros
  $$('.filtro-btn', ins).forEach((b) => b.onclick = () => { c.filtro.preset = b.dataset.f; mudou(); selecionar(id); });
  const slider = (sel, campo, txt) => ligar(sel, 'oninput', (e) => { c.filtro[campo] = +e.target.value; $(txt).textContent = (+e.target.value).toFixed(2); mudou(); });
  slider('#iBr', 'brilho', '#iBrTxt');
  slider('#iCo', 'contraste', '#iCoTxt');
  slider('#iSa', 'saturacao', '#iSaTxt');
  ligar('#iFiltroZerar', 'onclick', () => { c.filtro = { preset: c.filtro.preset, brilho: 0, contraste: 1, saturacao: 1 }; mudou(); selecionar(id); });
  ligar('#iFiltroTodos', 'onclick', () => { ed.clipes.forEach((x) => { x.filtro = { ...c.filtro }; }); mudou(); toast('Filtro aplicado em todos os clipes.', 'ok'); });
  // transição
  $$('.trans-btn', ins).forEach((b) => b.onclick = () => { c.transicao.tipo = b.dataset.t; mudou(); selecionar(id); irParaTempo(layoutTL().itens[i + 1].inicio - 0.3); });
  ligar('#iTrDur', 'oninput', (e) => { c.transicao.dur = +e.target.value; $('#iTrTxt').textContent = (+e.target.value).toFixed(1) + 's'; mudou(); });
  ligar('#iTrTodos', 'onclick', () => { ed.clipes.slice(0, -1).forEach((x) => { x.transicao = { ...c.transicao }; }); mudou(); toast('Transição aplicada entre todos os clipes.', 'ok'); });
  // texto do clipe
  if (abaClipe === 'texto') {
    $('#iPos').value = c.textoPos || 'base'; $('#iTam').value = c.textoTam || 'm'; $('#iFonte').value = c.fonte || 'negrito';
    const muda = (campo) => (e) => { c[campo] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; mudou(); };
    ligar('#iTexto', 'oninput', muda('texto'));
    ligar('#iPos', 'onchange', muda('textoPos'));
    ligar('#iTam', 'onchange', muda('textoTam'));
    ligar('#iFonte', 'onchange', muda('fonte'));
    ligar('#iCor', 'oninput', muda('textoCor'));
    ligar('#iFundo', 'onchange', muda('textoFundo'));
  }
}

// ---------- topo e exportação
function sincronizarTopo() {
  $('#edNome').value = ed.nome;
  $('#edFormato').value = ed.formato;
  $('#edFps').value = String(ed.fps);
  $('#edEncaixe').value = ed.encaixe;
  ajustarPalco();
}
$('#edNome').onchange = (e) => { ed.nome = e.target.value; salvarEdicao(); };
$('#edFormato').onchange = (e) => { ed.formato = e.target.value; salvarEdicao(); ajustarPalco(); };
$('#edFps').onchange = (e) => { ed.fps = +e.target.value; salvarEdicao(); };
$('#edEncaixe').onchange = (e) => { ed.encaixe = e.target.value; salvarEdicao(); ajustarPalco(); };

$('#btnExportar').onclick = async () => {
  if (!ed.clipes.length) return toast('Adicione clipes à timeline primeiro.', 'erro');
  const quebrado = ed.clipes.find(clipeQuebrado);
  if (quebrado) { selecionar('c:' + quebrado.uid); return toast('Há um clipe cujo arquivo foi apagado (⚠). Remova-o antes de exportar.', 'erro'); }
  pausar();
  const f = formatoPorId(ed.formato);
  const caixa = $('#edExport');
  caixa.hidden = false;
  caixa.innerHTML = '<b>Exportando…</b><div class="barra-prog"><i></i></div><span class="mono" id="expMsg">na fila</span>';
  $('#btnExportar').disabled = true;
  try {
    const { job } = await api('/api/exportar', { corpo: { ...ed, largura: f.largura, altura: f.altura } });
    const fim = await acompanharJob(job.id, (j) => {
      $('#edExport .barra-prog i').style.width = `${Math.round((j.progresso || 0) * 100)}%`;
      $('#expMsg').textContent = j.erro || j.ultima || '';
    });
    if (fim.status === 'ok') {
      const n = fim.resultado.nome;
      caixa.innerHTML = `<b style="color:var(--ok)">✓ Vídeo exportado</b><span class="mono">${esc(n)} · ${fim.resultado.duracao.toFixed(1)}s</span>
        <a class="btn mini primario" href="${urlMidia(n)}" download>⬇ Baixar</a>
        <a class="btn mini" href="${urlMidia(n)}" target="_blank">Assistir</a>
        <button class="btn mini" id="expPasta">Abrir pasta</button>
        <span class="espaco"></span><button class="btn mini fantasma" id="expFechar">×</button>`;
      $('#expPasta').onclick = () => api('/api/midia/abrir-pasta', { method: 'POST' });
      $('#expFechar').onclick = () => { caixa.hidden = true; };
      carregarMidia();
    } else {
      caixa.innerHTML = `<div class="erro-caixa" style="flex:1">Falha na exportação: ${esc(fim.erro)}</div><button class="btn mini" id="expFechar">×</button>`;
      $('#expFechar').onclick = () => { caixa.hidden = true; };
    }
  } catch (e) { toast(e.message, 'erro'); caixa.hidden = true; }
  $('#btnExportar').disabled = false;
};

async function carregarEdicao() {
  const salvo = await api('/api/edicao').catch(() => null);
  if (salvo && Array.isArray(salvo.clipes)) Object.assign(ed, salvo);
  if (!Array.isArray(ed.audios)) ed.audios = [];
  if (!Array.isArray(ed.textos)) ed.textos = [];
  ed.legendas = { ...legendasPadrao(), ...(ed.legendas || {}) };
  for (const c of ed.clipes) {
    c.velocidade ||= 1;
    c.filtro ||= { preset: '', brilho: 0, contraste: 1, saturacao: 1 };
    c.transicao ||= { tipo: 'nenhuma', dur: 0.5 };
  }
  sincronizarTopo();
  hist.pilha = [];
  hist.i = -1;
  registrar();
}

// ===================================================================== ESTÚDIO DE VOZ
// roteiro sobre o vídeo (IA assiste) → texto editável com tags → voz inteira na ElevenLabs → takes → colocar no vídeo
const TONS_VOZ = ['Confiante e energético', 'Emocional e inspirador', 'Calmo e premium', 'Urgente (oferta)', 'Divertido e jovem', 'Sério e técnico', 'Curiosidade / mistério'];
const TAGS_VOZ = [
  ['[excited]', 'animado'], ['[confident]', 'confiante'], ['[warm]', 'acolhedor'], ['[serious]', 'sério'],
  ['[whispers]', 'sussurro'], ['[curious]', 'curioso'], ['[dramatic]', 'dramático'], ['[laughs softly]', 'risinho'],
  ['[short pause]', 'pausa curta'], ['[long pause]', 'pausa longa'],
];
const vz = { id: null, p: null, l: null, modelos: null, audio: new Audio(), salvarT: null, obs: null };

async function abrirEstudioVoz() {
  const sel = $('#vzProjeto');
  const lista = (await api('/api/projetos')).filter((p) => p.versaoAtual);
  if (!lista.length) {
    sel.innerHTML = '';
    $('#vozGrade').innerHTML = '<div class="vazio-grande" style="grid-column:1/-1">Crie um projeto primeiro (aba Modelos → Gerar animação).</div>';
    return;
  }
  let lembrado = null;
  try { lembrado = localStorage.getItem('vozProjeto'); } catch {}
  const id = vz.id && lista.some((p) => p.id === vz.id) ? vz.id : lista.some((p) => p.id === lembrado) ? lembrado : lista[0].id;
  sel.innerHTML = lista.map((p) => `<option value="${p.id}" ${p.id === id ? 'selected' : ''}>${esc(p.nome)} · ${p.ajustes.duracao}s</option>`).join('');
  sel.onchange = () => carregarEstudioVoz(sel.value);
  if (vz.id !== id || !vz.l) await carregarEstudioVoz(id);
}

async function carregarEstudioVoz(id) {
  vz.id = id;
  try { localStorage.setItem('vozProjeto', id); } catch {}
  vz.audio.pause();
  const [p, l] = await Promise.all([api(`/api/projetos/${id}`), api(`/api/projetos/${id}/locucao`)]);
  vz.p = p; vz.l = l;
  if (!vz.modelos) vz.modelos = await api('/api/audio/modelos-eleven').catch(() => [{ id: 'eleven_v4', nome: 'Eleven v4' }]);
  desenharEstudioVoz();
  const emCurso = await api(`/api/projetos/${id}/audio/job`).catch(() => null);
  if (emCurso && (emCurso.status === 'rodando' || emCurso.status === 'fila')) seguirJobVoz(emCurso);
}

const salvarVoz = (imediato) => {
  clearTimeout(vz.salvarT);
  const id = vz.id;
  const f = () => api(`/api/projetos/${id}/locucao`, { method: 'PUT', corpo: vz.l }).catch((e) => toast(e.message, 'erro'));
  if (imediato) return f();
  vz.salvarT = setTimeout(f, 500);
};
// mesmas contas do servidor: ~2,3 palavras por segundo, no máximo 1000 palavras
const MAX_PALAVRAS_VOZ = 1000;
function alvoVoz(l, duracaoVideo) {
  const ritmo = 2.3 * Math.min(1.2, Math.max(0.7, +l.velocidade || 1));
  const lim = (n) => Math.max(4, Math.min(MAX_PALAVRAS_VOZ, Math.round(n)));
  if (l.modoTempo === 'palavras') return lim(+l.palavrasAlvo || 150);
  if (l.modoTempo === 'tempo') return lim((+l.duracaoAlvo || 60) * ritmo);
  return lim((duracaoVideo - 0.6) * ritmo);
}
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}min${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`);
const contarPalavras = (t) =>t.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).length;

function desenharEstudioVoz() {
  const { p, l } = vz;
  const { largura: W, altura: H, duracao } = p.ajustes;
  const alvo = alvoVoz(l, duracao);
  const nTakes = (l.takes || []).length;
  $('#vozGrade').innerHTML = `
    <section class="voz-col voz-video">
      <div class="voz-tela" id="vzTela"><iframe id="vzFrame" src="/p/${p.id}/?v=${p.versaoAtual}&t=${Date.now()}" width="${W}" height="${H}"></iframe></div>
      <div class="voz-barra">
        <button class="btn mini" id="vzReiniciar">↻ Reiniciar vídeo</button>
        <span class="espaco"></span>
        <span class="mono">${W}×${H} · ${duracao}s</span>
      </div>
    </section>

    <section class="voz-col">
      <h3>1 · Gerador de roteiro</h3>
      <label>Sobre o que a voz deve falar? <small>(produto, mensagem, oferta — opcional)</small>
        <textarea id="vzBriefing" rows="3" placeholder="Ex.: suplemento de creatina pura, 300 g, foco em força e recuperação; oferta de lançamento">${esc(l.briefing)}</textarea></label>
      <div class="voz-linha">
        <label>Tom<input id="vzTom" list="vzTons" value="${esc(l.tom)}" placeholder="Confiante e energético"><datalist id="vzTons">${TONS_VOZ.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></label>
        <label>Chamada final (CTA)<input id="vzCta" value="${esc(l.cta)}" placeholder="Ex.: Clique em saiba mais"></label>
      </div>
      <div class="voz-tempo">
        <label>Duração da fala
          <select id="vzModoTempo">
            <option value="video" ${l.modoTempo === 'video' ? 'selected' : ''}>Ajustar ao tempo do vídeo (${duracao}s)</option>
            <option value="tempo" ${l.modoTempo === 'tempo' ? 'selected' : ''}>Definir o tempo</option>
            <option value="palavras" ${l.modoTempo === 'palavras' ? 'selected' : ''}>Definir nº de palavras</option>
          </select></label>
        <label id="vzCampoTempo" ${l.modoTempo === 'tempo' ? '' : 'hidden'}>Segundos
          <input type="number" id="vzDuracaoAlvo" min="3" max="430" step="1" value="${+l.duracaoAlvo || 60}"></label>
        <label id="vzCampoPalavras" ${l.modoTempo === 'palavras' ? '' : 'hidden'}>Palavras (máx. ${MAX_PALAVRAS_VOZ})
          <input type="number" id="vzPalavrasAlvo" min="5" max="${MAX_PALAVRAS_VOZ}" step="5" value="${+l.palavrasAlvo || 150}"></label>
      </div>
      <p class="ajuda" id="vzTempoInfo"></p>
      <label class="check"><input type="checkbox" id="vzTags" ${l.comTags ? 'checked' : ''}> usar tags de emoção da ElevenLabs ([excited], [whispers]…)</label>
      <button class="btn primario" id="vzGerarRoteiro">👁 Assistir ao vídeo e gerar roteiro</button>
      <div id="vzJob" class="voz-job" hidden><div class="barra-prog"><i></i></div><small class="mono"></small></div>
      ${l.direcao ? `<div class="voz-direcao"><b>🎬 Direção de voz</b><p>${esc(l.direcao)}</p></div>` : ''}
      ${l.opcoes?.length ? `<div class="voz-opcoes">${l.opcoes.map((o, i) => `
        <button class="voz-opcao ${o.texto === l.texto ? 'ativa' : ''}" data-i="${i}"><b>${esc(o.titulo)}</b><span>${esc(o.texto)}</span><small>${contarPalavras(o.texto)} palavras · usar esta</small></button>`).join('')}</div>` : ''}

      <h3>2 · Roteiro final <small id="vzContagem"></small></h3>
      <div class="voz-tags">${TAGS_VOZ.map(([t, n]) => `<button data-tag="${esc(t)}" title="Inserir ${esc(t)} no cursor">${esc(n)}</button>`).join('')}</div>
      <textarea id="vzTexto" rows="9" placeholder="Escreva aqui ou gere com a IA acima. Quebras de linha e pontuação dão o ritmo da fala.">${esc(l.texto)}</textarea>
      <p class="ajuda">Vírgula = respiro curto · ponto = pausa · reticências… = suspense. As tags em inglês entre colchetes mudam a emoção (modelos v3/v4; nos outros são removidas).</p>
    </section>

    <section class="voz-col">
      <h3>3 · Voz (ElevenLabs)</h3>
      <div class="voz-escolhida"><div><small>Voz</small><b id="vzVozNome">${esc(l.vozNome || l.voz || 'nenhuma escolhida')}</b></div>
        <button class="btn" id="vzEscolher">🎧 Escolher voz</button></div>
      <label>Modelo<select id="vzModelo">${vz.modelos.map((m) => `<option value="${esc(m.id)}" ${m.id === (l.modelo || 'eleven_v4') ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></label>
      ${[['velocidade', 'Velocidade', 0.7, 1.2, 'Mais lenta', 'Mais rápida'],
        ['estabilidade', 'Estabilidade', 0, 1, 'Mais emotiva', 'Mais estável'],
        ['similaridade', 'Similaridade', 0, 1, 'Baixa', 'Alta'],
        ['estilo', 'Exagero de estilo', 0, 1, 'Nenhum', 'Exagerado']].map(([k, n, mi, ma, a, b]) => `
        <label class="voz-slider">${n} <span class="mono" id="vzV_${k}">${(+l[k]).toFixed(2)}</span>
          <input type="range" data-k="${k}" min="${mi}" max="${ma}" step="0.01" value="${l[k]}">
          <span class="voz-extremos"><small>${a}</small><small>${b}</small></span></label>`).join('')}
      <button class="btn primario grande" id="vzGerarVoz">🎙 Gerar voz</button>
      <p class="ajuda">Grava a locução INTEIRA de uma vez (entonação contínua, sem frases coladas). Cada clique cria um take novo e gasta créditos.</p>

      <h3>4 · Takes</h3>
      <div id="vzTakes" class="voz-takes">${nTakes ? l.takes.map((t, i) => {
        const longo = t.duracao > duracao + 0.05;
        return `
        <div class="voz-take" data-arq="${esc(t.arquivo)}">
          <div class="voz-take-topo"><b>Take ${nTakes - i}</b>${t.encaixeDe ? '<span class="voz-selo">🎯 encaixado no vídeo</span>' : ''}<span class="mono ${longo ? 'erro-txt' : ''}">${t.duracao.toFixed(1)}s${longo ? ' ⚠ maior que o vídeo' : ''}</span><small>${esc(t.vozNome || '')}</small></div>
          ${t.blocos ? `<div class="voz-mapa" title="Onde cada frase entra no vídeo">${t.blocos.map((b) => `<i style="left:${(b.inicio / duracao) * 100}%;width:${(b.dur / duracao) * 100}%" title="${b.inicio.toFixed(1)}s · ${esc(b.texto)}"></i>`).join('')}</div>` : ''}
          <audio controls preload="none" src="/p/${p.id}/audio/${esc(t.arquivo)}"></audio>
          <div class="voz-take-acoes">
            <button class="btn mini" data-acao="junto">▶ Ouvir com o vídeo</button>
            ${!t.encaixeDe && !longo && t.duracao < duracao - 1 ? `<button class="btn mini" data-acao="encaixar" title="A IA espalha as frases pelo vídeo, cada uma na cena certa (sem mudar a voz)">🎯 Encaixar nos ${duracao}s</button>` : ''}
            <button class="btn mini primario" data-acao="usar">✔ Colocar no vídeo</button>
            <a class="btn mini" href="/p/${p.id}/audio/${esc(t.arquivo)}" download="locucao-take${nTakes - i}.mp3" title="Baixar MP3">⬇</a>
            <button class="btn mini perigo" data-acao="apagar" title="Apagar take">✕</button>
          </div>
        </div>`;
      }).join('') : '<p class="ajuda">Nenhum take ainda.</p>'}</div>
    </section>`;

  // vídeo encaixado na coluna
  const encaixar = () => {
    const area = $('#vzTela'), f = $('#vzFrame');
    if (!area || !f) return;
    const e = Math.min((area.clientWidth - 16) / W, (area.clientHeight - 16) / H);
    f.style.transform = `translate(-50%, -50%) scale(${e})`;
  };
  encaixar();
  vz.obs?.disconnect();
  vz.obs = new ResizeObserver(encaixar);
  vz.obs.observe($('#vzTela'));
  const reiniciar = () => { const f = $('#vzFrame'); f.src = f.src.replace(/&t=\d+/, '&t=' + Date.now()); return f; };
  $('#vzReiniciar').onclick = () => { vz.audio.pause(); reiniciar(); };

  // campos (salvam sozinhos)
  const ligar = (sel, k, ev = 'input', ler = (el) => el.value) => { $(sel).addEventListener(ev, (e) => { l[k] = ler(e.target); salvarVoz(); }); };
  ligar('#vzBriefing', 'briefing'); ligar('#vzTom', 'tom'); ligar('#vzCta', 'cta');
  ligar('#vzTags', 'comTags', 'change', (el) => el.checked);
  ligar('#vzModelo', 'modelo', 'change');
  const contagem = () => {
    const alvo = alvoVoz(l, duracao);
    const ritmo = 2.3 * (+l.velocidade || 1);
    const n = contarPalavras($('#vzTexto').value);
    const seg = n / ritmo;
    const el = $('#vzContagem');
    el.textContent = `${n}/${alvo} palavras · ~${fmtDur(seg)} de fala`;
    // no modo "vídeo" passar do alvo é problema; nos outros é só referência (até 1000)
    el.className = (l.modoTempo === 'video' ? n > alvo : n > MAX_PALAVRAS_VOZ) ? 'erro-txt' : '';
    const segAlvo = alvo / ritmo;
    $('#vzTempoInfo').textContent = l.modoTempo === 'video'
      ? `A IA escreve até ${alvo} palavras para caber nos ${duracao}s do vídeo.`
      : `A IA escreve ~${alvo} palavras (~${fmtDur(segAlvo)} de fala).${segAlvo > duracao + 0.5 ? ` O vídeo tem ${duracao}s: depois de colocar a voz, use “Sincronizar a animação” para o vídeo ganhar o tempo da fala.` : ''}`;
  };
  contagem();
  $('#vzModoTempo').onchange = (e) => {
    l.modoTempo = e.target.value;
    $('#vzCampoTempo').hidden = l.modoTempo !== 'tempo';
    $('#vzCampoPalavras').hidden = l.modoTempo !== 'palavras';
    contagem(); salvarVoz();
  };
  $('#vzDuracaoAlvo').oninput = (e) => { l.duracaoAlvo = Math.max(3, Math.min(430, +e.target.value || 60)); contagem(); salvarVoz(); };
  $('#vzPalavrasAlvo').oninput = (e) => { l.palavrasAlvo = Math.max(5, Math.min(MAX_PALAVRAS_VOZ, +e.target.value || 150)); contagem(); salvarVoz(); };
  $('#vzTexto').addEventListener('input', (e) => { l.texto = e.target.value; contagem(); salvarVoz(); });
  $$('.voz-tags button').forEach((b) => b.onclick = () => {
    const t = $('#vzTexto');
    const ini = t.selectionStart ?? t.value.length;
    t.value = t.value.slice(0, ini) + b.dataset.tag + ' ' + t.value.slice(ini);
    t.focus();
    t.selectionStart = t.selectionEnd = ini + b.dataset.tag.length + 1;
    l.texto = t.value; contagem(); salvarVoz();
  });
  $$('.voz-opcao').forEach((b) => b.onclick = () => {
    l.texto = l.opcoes[+b.dataset.i].texto;
    $('#vzTexto').value = l.texto;
    $$('.voz-opcao').forEach((x) => x.classList.toggle('ativa', x === b));
    contagem(); salvarVoz();
  });
  $$('.voz-slider input').forEach((r) => r.oninput = () => {
    l[r.dataset.k] = +r.value;
    $(`#vzV_${r.dataset.k}`).textContent = (+r.value).toFixed(2);
    if (r.dataset.k === 'velocidade') contagem();
    salvarVoz();
  });
  $('#vzEscolher').onclick = () => abrirSeletorVozes(l.voz, (v) => {
    l.voz = v.id; l.vozNome = v.nome;
    $('#vzVozNome').textContent = v.nome;
    salvarVoz(true);
  });

  $('#vzGerarRoteiro').onclick = async () => {
    await salvarVoz(true);
    try {
      const r = await api(`/api/projetos/${p.id}/locucao/roteiro`, { corpo: {} });
      seguirJobVoz(r.job);
    } catch (e) { toast(e.message, 'erro'); }
  };

  $('#vzGerarVoz').onclick = async (e) => {
    const b = e.currentTarget;
    if (!l.voz) { toast('Escolha uma voz primeiro (🎧 Escolher voz).', 'erro'); return; }
    if (!l.texto.trim()) { toast('Escreva ou gere o roteiro primeiro.', 'erro'); return; }
    await salvarVoz(true);
    b.disabled = true; b.textContent = '🎙 Gravando a locução…';
    try {
      const r = await api(`/api/projetos/${p.id}/locucao/take`, { corpo: {} });
      vz.l = r.locucao;
      desenharEstudioVoz();
      // voz mais curta que o vídeo: encaixa sozinho (cada frase na cena certa)
      const auto = $('.voz-take [data-acao="encaixar"]');
      if (auto) { toast(`Take pronto (${r.take.duracao.toFixed(1)}s). Encaixando automaticamente nos ${duracao}s do vídeo…`, 'ok'); auto.click(); }
      else { toast(`Take pronto: ${r.take.duracao.toFixed(1)}s`, 'ok'); $('.voz-take audio')?.play().catch(() => {}); }
    } catch (err) { toast(err.message, 'erro'); b.disabled = false; b.textContent = '🎙 Gerar voz'; }
  };

  $$('.voz-take').forEach((el) => {
    const arq = el.dataset.arq;
    $$('[data-acao]', el).forEach((b) => b.onclick = async () => {
      const acao = b.dataset.acao;
      if (acao === 'junto') {
        $$('.voz-take audio').forEach((a) => a.pause());
        vz.audio.pause();
        vz.audio.src = `/p/${p.id}/audio/${arq}`;
        const f = reiniciar();
        f.onload = () => { f.onload = null; vz.audio.currentTime = 0; vz.audio.play().catch(() => toast('O navegador bloqueou o som. Clique de novo.', 'erro')); };
      } else if (acao === 'encaixar') {
        b.disabled = true; b.textContent = 'Encaixando…';
        try {
          const r = await api(`/api/projetos/${p.id}/locucao/encaixar`, { corpo: { arquivo: arq } });
          const j = await acompanharJob(r.job.id, (x) => { b.textContent = x.ultima ? x.ultima.slice(0, 38) + '…' : 'Encaixando…'; });
          if (j.status === 'erro') throw new Error(j.erro || 'Falhou');
          toast('Voz encaixada no vídeo — ouça o novo take com “▶ Ouvir com o vídeo”.', 'ok');
          vz.l = await api(`/api/projetos/${p.id}/locucao`);
          desenharEstudioVoz();
        } catch (err) { toast(err.message, 'erro'); b.disabled = false; b.textContent = '🎯 Encaixar no vídeo'; }
      } else if (acao === 'apagar') {
        if (!confirm('Apagar este take?')) return;
        vz.l = await api(`/api/projetos/${p.id}/locucao/take/${encodeURIComponent(arq)}`, { method: 'DELETE' });
        desenharEstudioVoz();
      } else if (acao === 'usar') {
        b.disabled = true; b.textContent = 'Colocando…';
        try {
          const r = await api(`/api/projetos/${p.id}/locucao/usar`, { corpo: { arquivo: arq } });
          const j = await acompanharJob(r.job.id, (x) => { b.textContent = x.ultima ? x.ultima.slice(0, 38) + '…' : 'Colocando…'; });
          if (j.status === 'erro') throw new Error(j.erro || 'Falhou');
          mostrarVozColocada(p);
        } catch (err) { toast(err.message, 'erro'); }
        b.disabled = false; b.textContent = '✔ Colocar no vídeo';
      }
    });
  });
}

function seguirJobVoz(job) {
  const caixa = $('#vzJob');
  if (!caixa) return;
  caixa.hidden = false;
  $('#vzGerarRoteiro').disabled = true;
  const id = vz.id;
  acompanharJob(job.id, (j) => {
    if (!$('#vzJob')) return;
    $('#vzJob i').style.width = Math.round((j.progresso || 0) * 100) + '%';
    $('#vzJob small').textContent = j.ultima || j.rotulo || '';
  }).then(async (j) => {
    if (j.status === 'erro') toast(j.erro || 'Falhou', 'erro');
    else toast('Roteiro pronto — escolha uma das opções.', 'ok');
    if (vz.id === id) await carregarEstudioVoz(id);
  });
}

function mostrarVozColocada(p) {
  $('#modal').innerHTML = `<div class="modal-caixa simples"><button class="fechar">×</button>
    <h2>✔ Voz colocada no vídeo</h2>
    <p>A locução agora é a voz do projeto <b>${esc(p.nome)}</b> (aba Som → “Meu áudio gravado”) e entra no <b>Renderizar</b> e no <b>🔊 Assistir com som</b>.</p>
    <p>Quer que a animação acompanhe essa voz? A IA refaz os tempos para cada texto e cena entrarem quando a voz fala aquilo. Vira uma versão nova; a atual continua salva.</p>
    <div class="voz-linha" style="margin-top:14px">
      <button class="btn primario" id="vcSinc">✦ Sincronizar a animação com a voz</button>
      <button class="btn" id="vcAbrir">Abrir o projeto</button>
    </div></div>`;
  $('#modal').hidden = false;
  $('#modal .fechar').onclick = fecharModal;
  $('#vcAbrir').onclick = () => { fecharModal(); estado.abaProjeto = 'som'; abrirProjeto(p.id); };
  $('#vcSinc').onclick = async () => {
    try {
      await api(`/api/projetos/${p.id}/audio/sincronizar`, { corpo: { ajustarDuracao: true } });
      fecharModal();
      toast('Sincronizando a animação com a voz…', 'ok');
      estado.abaProjeto = 'refinar';
      abrirProjeto(p.id);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

// ===================================================================== CENAS IA (Kie.ai)
// clipes realistas (Veo 3.1, Kling, Seedance, Grok) pagos por geração no Kie.ai → caem na Mídia do Editor
const kz = {
  modelos: null, cfg: null, imagens: [], acompanhando: new Set(),
  form: (() => { try { return JSON.parse(localStorage.getItem('kieForm') || '{}'); } catch { return {}; } })(),
};
const salvarFormKie = () => { try { localStorage.setItem('kieForm', JSON.stringify(kz.form)); } catch {} };

async function abrirKie() {
  if (!kz.modelos) kz.modelos = await api('/api/kie/modelos');
  kz.perfis = await api('/api/kie/perfis').catch(() => []);
  kz.cfg = await api('/api/kie/config');
  desenharKie();
  desenharHistoricoKie();
}

function desenharKie() {
  const f = kz.form;
  const m = kz.modelos.find((x) => x.id === f.modelo) || kz.modelos[0];
  f.modelo = m.id;
  if (!m.aspectos.includes(f.aspecto)) f.aspecto = m.aspectos[0];
  if (!m.duracoes.includes(+f.duracao)) f.duracao = m.duracoes[0];
  if (!m.resolucoes.includes(f.resolucao)) f.resolucao = m.resolucoes[0];
  const grupos = [...new Set(kz.modelos.map((x) => x.grupo))];
  const usaUso = ['veo3_fast', 'veo3_lite', 'bytedance/seedance-2-fast'].includes(m.id);
  $('#kieForm').innerHTML = `
    <div class="kie-chave">${kz.cfg.configurado
      ? `<span>🔑 Chave Kie.ai ••••${esc(kz.cfg.final)}</span><span class="mono" id="kieSaldo">saldo…</span><span class="espaco"></span>
         <button class="btn mini" id="kieTrocar">Trocar</button>`
      : `<label>Chave do Kie.ai <small>(<a href="https://kie.ai/api-key" target="_blank" rel="noopener">pegar em kie.ai → API Key</a>; fica salva só neste PC)</small>
           <div class="voz-linha"><input type="password" id="kieChave" placeholder="cole a chave aqui" autocomplete="off"><button class="btn primario" id="kieSalvarChave">Salvar</button></div></label>`}
    </div>

    <label>Modelo
      <select id="kieModelo">${grupos.map((g) => `<optgroup label="${esc(g)}">${kz.modelos.filter((x) => x.grupo === g).map((x) => `<option value="${esc(x.id)}" ${x.id === m.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</optgroup>`).join('')}</select></label>
    <p class="ajuda kie-dica">💡 ${esc(m.dica)} · <b>Preço:</b> ${esc(m.estimativa)}</p>

    <div class="kie-mapa">
      <label>🧬 Mapa do personagem <small>(mantém a mesma pessoa/produto/estilo em todos os vídeos)</small>
        <div class="voz-linha"><select id="kiePerfil"><option value="">Nenhum</option>${(kz.perfis || []).map((p) => `<option value="${esc(p.id)}" ${p.id === f.perfilId ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>
          <button class="btn" id="kieNovoPerfil">＋ Novo mapa</button></div></label>
      ${(() => {
        const p = (kz.perfis || []).find((x) => x.id === f.perfilId);
        if (!p) return '';
        return `<div class="kie-perfil">
          <div class="kie-imgs">${p.imagens.map((n) => `<div class="kie-img" style="background-image:url('/kie/imagens/${encodeURIComponent(n)}')"></div>`).join('') || '<small class="ajuda">sem fotos (só descrição)</small>'}</div>
          <details><summary>Descrição fixa (vai em todo prompt) — clique para ver/editar</summary>
            <textarea id="kieDna" rows="7">${esc(p.dna)}</textarea>
            <div class="voz-linha"><button class="btn mini" id="kieSalvarDna">Salvar descrição</button><button class="btn mini perigo" id="kieApagarPerfil">Apagar mapa</button></div></details>
          <p class="ajuda">${['veo3_fast', 'veo3_lite', 'bytedance/seedance-2-fast'].includes(m.id) ? '✔ As fotos do personagem vão como referência neste modelo.' : 'Neste modelo o personagem segue pela descrição (as fotos de referência funcionam no Veo Fast/Lite e no Seedance).'}</p>
        </div>`;
      })()}
    </div>
    ${kz.continuacao ? `<div class="kie-continua">➡ Continuando do vídeo anterior: o último quadro dele é o primeiro deste. <button class="btn mini" id="kieCancelarCont">✕ cancelar</button></div>` : ''}

    <label>${kz.continuacao ? 'O que acontece em seguida?' : 'Sua ideia'} <small>(em português)</small>
      <textarea id="kieIdeia" rows="3" placeholder="Ex.: mulher de 28 anos na cozinha, segurando o pote do produto, falando animada que toma todo dia depois do treino">${esc(f.ideia || '')}</textarea></label>
    <div class="voz-linha">
      <label class="check"><input type="checkbox" id="kieFala" ${f.comFala !== false ? 'checked' : ''}> pessoa falando (fala em português)</label>
      <button class="btn" id="kiePromptIA">✦ Escrever prompt com IA</button>
    </div>
    <label>Prompt do vídeo <small>(é isso que vai para o modelo)</small>
      <textarea id="kiePrompt" rows="7" placeholder="Escreva o prompt ou gere com a IA acima.">${esc(f.prompt || '')}</textarea></label>

    <div>
      <div class="kie-imgs" id="kieImgs">${kz.imagens.map((im, i) => `<div class="kie-img" style="background-image:url('${im.url}')"><button data-i="${i}" title="Remover">×</button></div>`).join('')}
        ${kz.imagens.length < m.maxImagens ? `<label class="kie-img kie-add" title="Foto do produto, da pessoa ou do cenário">＋<small>imagem</small><input type="file" id="kieArq" accept="image/png,image/jpeg,image/webp" multiple hidden></label>` : ''}</div>
      <p class="ajuda">Até ${m.maxImagens} imagem(ns): foto do produto, da pessoa ou do cenário (opcional).</p>
      ${usaUso && kz.imagens.length ? `<label>Como usar as imagens<select id="kieUso">
        <option value="quadro" ${f.usoImagem !== 'referencia' ? 'selected' : ''}>Primeiro quadro (o vídeo começa nessa imagem)</option>
        <option value="referencia" ${f.usoImagem === 'referencia' ? 'selected' : ''}>Referência (manter este produto/pessoa na cena)</option></select></label>` : ''}
    </div>

    <div class="voz-linha">
      <label>Formato<select id="kieAspecto">${m.aspectos.map((a) => `<option ${a === f.aspecto ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      <label>Duração<select id="kieDuracao">${m.duracoes.map((d) => `<option value="${d}" ${d === +f.duracao ? 'selected' : ''}>${d}s</option>`).join('')}</select></label>
      <label>Qualidade<select id="kieRes">${m.resolucoes.map((r) => `<option value="${r}" ${r === f.resolucao ? 'selected' : ''}>${esc(m.rotuloResolucao?.[r] || r)}</option>`).join('')}</select></label>
    </div>
    ${m.audio ? `<label class="check"><input type="checkbox" id="kieAudio" ${f.audio !== false ? 'checked' : ''}> gerar áudio junto</label>` : '<p class="ajuda">Este modelo já gera o vídeo com áudio.</p>'}
    <button class="btn primario grande" id="kieGerar" ${kz.cfg.configurado ? '' : 'disabled'}>🎬 Gerar vídeo (usa créditos do Kie.ai)</button>
    <p class="ajuda">O vídeo pronto vai direto para a <b>Mídia do Editor</b>. O custo real aparece em cada resultado. Comece testando no modelo mais barato e só refaça no melhor quando o prompt estiver bom.</p>`;

  // chave
  if (kz.cfg.configurado) {
    api('/api/kie/saldo').then((s) => { if ($('#kieSaldo')) $('#kieSaldo').textContent = `saldo: ${s.creditos} créditos (US$ ${s.dolares.toFixed(2)})`; })
      .catch((e) => { if ($('#kieSaldo')) $('#kieSaldo').textContent = e.message; });
    $('#kieTrocar').onclick = () => { kz.cfg = { configurado: false }; desenharKie(); };
  } else {
    $('#kieSalvarChave').onclick = async () => {
      const chave = $('#kieChave').value.trim();
      if (!chave) return toast('Cole a chave primeiro.', 'erro');
      try {
        const r = await api('/api/kie/config', { method: 'PUT', corpo: { chave } });
        toast(`Kie.ai conectado! Saldo: ${r.saldo} créditos.`, 'ok');
        kz.cfg = await api('/api/kie/config');
        desenharKie();
      } catch (e) { toast(e.message, 'erro'); }
    };
  }

  const lembrar = (sel, k, ev = 'input', ler = (el) => el.value) => { const el = $(sel); if (el) el.addEventListener(ev, () => { f[k] = ler(el); salvarFormKie(); }); };
  lembrar('#kieIdeia', 'ideia'); lembrar('#kiePrompt', 'prompt');
  lembrar('#kieFala', 'comFala', 'change', (el) => el.checked);
  lembrar('#kieAudio', 'audio', 'change', (el) => el.checked);
  lembrar('#kieAspecto', 'aspecto', 'change'); lembrar('#kieDuracao', 'duracao', 'change'); lembrar('#kieRes', 'resolucao', 'change');
  lembrar('#kieUso', 'usoImagem', 'change');
  // mapa do personagem
  $('#kiePerfil').onchange = (e) => { f.perfilId = e.target.value; salvarFormKie(); desenharKie(); };
  $('#kieNovoPerfil').onclick = () => abrirNovoPerfil();
  if ($('#kieSalvarDna')) $('#kieSalvarDna').onclick = async () => {
    try { await api(`/api/kie/perfis/${f.perfilId}`, { method: 'PUT', corpo: { dna: $('#kieDna').value } }); kz.perfis = await api('/api/kie/perfis'); toast('Descrição salva.', 'ok'); } catch (e) { toast(e.message, 'erro'); }
  };
  if ($('#kieApagarPerfil')) $('#kieApagarPerfil').onclick = async () => {
    if (!confirm('Apagar este mapa? Os vídeos já gerados continuam.')) return;
    await api(`/api/kie/perfis/${f.perfilId}`, { method: 'DELETE' });
    f.perfilId = ''; salvarFormKie(); kz.perfis = await api('/api/kie/perfis'); desenharKie();
  };
  if ($('#kieCancelarCont')) $('#kieCancelarCont').onclick = () => { kz.continuacao = null; kz.imagens = []; desenharKie(); };

  $('#kieModelo').onchange = (e) => { f.modelo = e.target.value; salvarFormKie(); kz.imagens = kz.imagens.slice(0, (kz.modelos.find((x) => x.id === f.modelo) || m).maxImagens); desenharKie(); };

  // imagens
  $$('#kieImgs button').forEach((b) => b.onclick = () => { kz.imagens.splice(+b.dataset.i, 1); desenharKie(); });
  const arq = $('#kieArq');
  if (arq) arq.onchange = async () => {
    for (const file of [...arq.files].slice(0, m.maxImagens - kz.imagens.length)) {
      try {
        const r = await fetch(`/api/kie/imagem?nome=${encodeURIComponent(file.name)}`, { method: 'POST', body: file }).then((x) => x.json());
        if (r.erro) throw new Error(r.erro);
        kz.imagens.push(r);
      } catch (e) { toast(e.message, 'erro'); }
    }
    desenharKie();
  };

  // prompt com IA
  $('#kiePromptIA').onclick = async (e) => {
    const b = e.currentTarget;
    if (!$('#kieIdeia').value.trim()) return toast('Escreva a sua ideia primeiro.', 'erro');
    b.disabled = true; b.textContent = '✦ Escrevendo…';
    try {
      const r = await api('/api/kie/prompt', { corpo: { ideia: $('#kieIdeia').value, modelo: f.modelo, comFala: $('#kieFala').checked, aspecto: f.aspecto, duracao: f.duracao, perfilId: f.perfilId || null, anterior: kz.continuacao?.prompt || null } });
      $('#kiePrompt').value = r.prompt; f.prompt = r.prompt; salvarFormKie();
    } catch (err) { toast(err.message, 'erro'); }
    b.disabled = false; b.textContent = '✦ Escrever prompt com IA';
  };

  // gerar
  $('#kieGerar').onclick = async () => {
    const prompt = $('#kiePrompt').value.trim();
    if (!prompt) return toast('Escreva o prompt (ou gere com a IA).', 'erro');
    if (!confirm(`Gerar com ${m.nome}?\n\nPreço aproximado: ${m.estimativa}.\nOs créditos são descontados da sua conta Kie.ai.`)) return;
    try {
      const r = await api('/api/kie/gerar', { corpo: {
        modelo: m.id, prompt, imagens: kz.imagens.map((x) => x.nome), usoImagem: f.usoImagem, aspecto: f.aspecto,
        duracao: f.duracao, resolucao: f.resolucao, audio: f.audio !== false, perfilId: f.perfilId || null,
        ...(kz.continuacao ? { usoImagem: 'quadro' } : {}),
      } });
      kz.continuacao = null;
      toast('Enviado ao Kie.ai. Você pode continuar usando o estúdio enquanto gera.', 'ok');
      await desenharHistoricoKie();
      acompanharKie(r.job.id);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

async function desenharHistoricoKie() {
  const h = await api('/api/kie/historico');
  const el = $('#kieHistorico');
  if (!el) return;
  el.innerHTML = h.length ? h.map((x) => `
    <div class="kie-item ${x.status}" data-id="${esc(x.id)}">
      <div class="kie-midia">${x.status === 'pronto' && x.midia
        ? `<video src="/arquivos/midia/${encodeURIComponent(x.midia)}" controls preload="metadata" playsinline></video>`
        : x.status === 'erro' ? `<div class="kie-msg erro-txt">⚠ ${esc(x.erro || 'falhou')}</div>`
          : `<div class="kie-msg"><div class="spinner"></div><span class="mono" data-msg>gerando…</span></div>`}</div>
      <div class="kie-info">
        <b>${esc(x.modeloNome)}</b>
        ${x.perfilNome ? `<small>🧬 ${esc(x.perfilNome)}</small>` : ''}
        <small class="mono">${quando(x.criado)} · ${esc(x.opcoes?.aspecto || '')} · ${x.duracao ? x.duracao.toFixed(1) + 's' : (x.opcoes?.duracao || '') + 's'}${x.custoCreditos != null ? ` · ${x.custoCreditos} créd. (US$ ${x.custoDolar?.toFixed(2)})` : ''}</small>
        <p title="${esc(x.prompt)}">${esc(x.prompt)}</p>
        <div class="voz-take-acoes">
          <button class="btn mini" data-a="reusar" title="Coloca este prompt e modelo no formulário">↻ Reusar prompt</button>
          ${x.status === 'pronto' ? `<button class="btn mini" data-a="continuar" title="Gera o próximo clipe começando do último quadro deste">➡ Continuar</button><button class="btn mini primario" data-a="editor">✂ Abrir no Editor</button><a class="btn mini" href="/arquivos/midia/${encodeURIComponent(x.midia)}" download>⬇</a>` : ''}
          ${x.status !== 'gerando' ? '<button class="btn mini perigo" data-a="tirar" title="Tirar da lista (o vídeo continua na Mídia)">✕</button>' : ''}
        </div>
      </div>
    </div>`).join('') : '<div class="vazio-grande">Nenhum vídeo gerado ainda.<br><br>Escreva a ideia, gere o prompt com a IA e clique em 🎬 Gerar.</div>';
  for (const x of h) if (x.status === 'gerando') acompanharKie(x.id);
  $$('.kie-item', el).forEach((card) => {
    const x = h.find((y) => y.id === card.dataset.id);
    $$('[data-a]', card).forEach((b) => b.onclick = async () => {
      if (b.dataset.a === 'reusar') {
        Object.assign(kz.form, { modelo: x.modelo, prompt: x.prompt, ...x.opcoes });
        delete kz.form.imagens;
        salvarFormKie(); desenharKie(); toast('Prompt e ajustes colocados no formulário.');
      } else if (b.dataset.a === 'continuar') {
        try {
          const r = await api('/api/kie/continuar', { corpo: { id: x.id } });
          kz.imagens = [r.imagem];
          kz.continuacao = { prompt: r.anterior.prompt };
          Object.assign(kz.form, { modelo: r.anterior.modelo, ...(r.anterior.opcoes || {}), usoImagem: 'quadro', perfilId: r.anterior.perfilId || kz.form.perfilId, ideia: '', prompt: '' });
          delete kz.form.imagens;
          salvarFormKie(); desenharKie();
          $('#kieIdeia')?.focus();
          toast('Escreva o que acontece em seguida e clique em ✦ Escrever prompt com IA.', 'ok');
        } catch (e) { toast(e.message, 'erro'); }
      } else if (b.dataset.a === 'editor') {
        await carregarMidia(); irPara('editor'); toast('O vídeo está na lista de Mídia (à esquerda). Arraste para a timeline.', 'ok');
      } else if (b.dataset.a === 'tirar') {
        await api(`/api/kie/historico/${encodeURIComponent(x.id)}`, { method: 'DELETE' });
        desenharHistoricoKie();
      }
    });
  });
}

// criar mapa: fotos SÓ do personagem (rosto, corpo, roupa) + notas → a IA escreve a descrição fixa
function abrirNovoPerfil() {
  const fotos = [];
  $('#modal').innerHTML = `<div class="modal-caixa simples"><button class="fechar">×</button>
    <h2>🧬 Novo mapa do personagem</h2>
    <p class="ajuda">Envie de 1 a 4 fotos <b>só do personagem</b> (rosto de frente, corpo inteiro, a roupa). Elas vão como referência em todos os vídeos com este mapa, e a IA escreve uma descrição fixa para manter as mesmas características.</p>
    <label>Nome<input id="npNome" placeholder="Ex.: Ana — atleta UGC"></label>
    <div class="kie-imgs" id="npFotos"></div>
    <label class="btn" style="width:max-content">＋ Fotos do personagem<input type="file" id="npArq" accept="image/png,image/jpeg,image/webp" multiple hidden></label>
    <label>Detalhes que não aparecem na foto <small>(opcional)</small>
      <textarea id="npNotas" rows="3" placeholder="Ex.: brasileira, 28 anos, voz animada e simpática, sempre com top cinza; produto: pote preto com tampa dourada"></textarea></label>
    <button class="btn primario" id="npCriar">✦ Criar mapa (a IA analisa as fotos)</button>
  </div>`;
  $('#modal').hidden = false;
  $('#modal .fechar').onclick = fecharModal;
  const desenharFotos = () => {
    $('#npFotos').innerHTML = fotos.map((im, i) => `<div class="kie-img" style="background-image:url('${im.url}')"><button data-i="${i}">×</button></div>`).join('');
    $$('#npFotos button').forEach((b) => b.onclick = () => { fotos.splice(+b.dataset.i, 1); desenharFotos(); });
  };
  $('#npArq').onchange = async (e) => {
    for (const file of [...e.target.files].slice(0, 4 - fotos.length)) {
      const r = await fetch(`/api/kie/imagem?nome=${encodeURIComponent(file.name)}`, { method: 'POST', body: file }).then((x) => x.json());
      if (r.erro) toast(r.erro, 'erro'); else fotos.push(r);
    }
    desenharFotos();
  };
  $('#npCriar').onclick = async (e) => {
    const b = e.currentTarget;
    const nome = $('#npNome').value.trim();
    if (!nome) return toast('Dê um nome ao mapa.', 'erro');
    if (!fotos.length && !$('#npNotas').value.trim()) return toast('Envie fotos do personagem ou descreva.', 'erro');
    b.disabled = true; b.textContent = '✦ A IA está analisando as fotos…';
    try {
      const p = await api('/api/kie/perfis', { corpo: { nome, imagens: fotos.map((x) => x.nome), notas: $('#npNotas').value } });
      kz.perfis = await api('/api/kie/perfis');
      kz.form.perfilId = p.id; salvarFormKie();
      fecharModal(); desenharKie();
      toast(`Mapa “${p.nome}” criado. Os próximos vídeos usam este personagem.`, 'ok');
    } catch (err) { toast(err.message, 'erro'); b.disabled = false; b.textContent = '✦ Criar mapa (a IA analisa as fotos)'; }
  };
}

function acompanharKie(id) {
  if (kz.acompanhando.has(id)) return;
  kz.acompanhando.add(id);
  acompanharJob(id, (j) => {
    const span = $(`.kie-item[data-id="${id}"] [data-msg]`);
    if (span) span.textContent = j.ultima || 'gerando…';
  }).then((j) => {
    kz.acompanhando.delete(id);
    if (j.status === 'ok') { toast('Vídeo do Kie.ai pronto! ' + (j.ultima || ''), 'ok'); carregarMidia(); }
    else if (j.erro && !/não encontrada/.test(j.erro)) toast('Kie.ai: ' + j.erro, 'erro');
    if (estado.vista === 'kie') { desenharHistoricoKie(); api('/api/kie/saldo').then((s) => { if ($('#kieSaldo')) $('#kieSaldo').textContent = `saldo: ${s.creditos} créditos (US$ ${s.dolares.toFixed(2)})`; }).catch(() => {}); }
  });
}

// ===================================================================== OPUS GENERATOR (WanGP / MiniMax H3 local)
// confere a máquina, instala o WanGP (GitHub oficial + instalador dele) e traz os vídeos gerados para a Mídia
const gz = { info: null, videos: [] };
const ICONE_NIVEL = { ok: '✅', aviso: '⚠️', falha: '❌' };
const PROMPT_GERADOR = `integrated_multimodal_description: [Shot 1] Live-action, photorealistic, authentic UGC smartphone selfie video, vertical framing, natural skin texture, sharp focus on her face and mouth. A Brazilian woman in her late twenties with long wavy dark hair, wearing a casual t-shirt, sits on a sofa in a cozy living room lit by soft natural window light. She holds the phone at arm's length, the camera has subtle natural handheld shake. Looking into the camera like she is telling a close friend a secret, with a warm, casual Brazilian voice and a natural conversational rhythm with small pauses (S1), she says: <d>[Portuguese] Gente... vocês precisam conhecer isso. Sério!</d> At the end she smiles and gives a small laugh.
overall_soundscape: Quiet living room room tone continues underneath, with faint distant street ambience through an open window.
non_diegetic_music: None.`;

async function abrirGerador() {
  $('#gerMaquina').innerHTML = '<h3>Sua máquina</h3><p class="ajuda">Verificando placa de vídeo, memória e disco…</p>';
  try { gz.info = await api('/api/gerador/maquina'); } catch (e) { $('#gerMaquina').innerHTML = `<h3>Sua máquina</h3><p class="ajuda">${esc(e.message)}</p>`; return; }
  desenharGerador();
  carregarVideosGerador();
  if (gz.info.instalando) acompanharInstalacao(gz.info.instalando);
}

function desenharGerador() {
  const g = gz.info;
  const R = g.requisitos;
  const ram = g.maquina.ram;
  const perfil = ram >= R.ramBoa ? '4 (padrão)' : '5 (Fail safe)';

  $('#gerMaquina').innerHTML = `
    <div class="voz-linha"><h3>Sua máquina</h3><span class="espaco"></span><button class="btn mini" id="gerReverificar">⟳ Verificar de novo</button></div>
    <div class="ger-veredito n-${g.veredito.nivel}">${ICONE_NIVEL[g.veredito.nivel]} ${esc(g.veredito.texto)}</div>
    <ul class="ger-itens">${g.itens.map((i) => `
      <li class="n-${i.nivel}"><span class="ger-ic">${ICONE_NIVEL[i.nivel]}</span>
        <div><b>${esc(i.nome)}</b> <span class="mono">${esc(i.valor)}</span><small>${esc(i.detalhe)}</small></div></li>`).join('')}
    </ul>
    <p class="ajuda">Sem placa compatível? Teste online no <a href="https://huggingface.co/spaces/MiniMaxAI/MiniMax-H3-Turbo-Lora" target="_blank" rel="noopener">Space oficial da MiniMax</a> (grátis, 2–5 min de GPU por dia) ou no <a href="https://hailuoai.video/tools/minimax-h3" target="_blank" rel="noopener">Hailuo AI</a> (pago por segundo).</p>`;

  $('#gerRequisitos').innerHTML = `
    <h3>Pré-requisitos</h3>
    <table class="ger-tabela">
      <thead><tr><th></th><th>Mínimo</th><th>Recomendado</th></tr></thead>
      <tbody>
        <tr><td>Placa de vídeo</td><td>NVIDIA GTX 10xx a RTX 50xx, ou AMD RX 6000+ (RDNA 2)</td><td>NVIDIA RTX 30xx ou mais nova</td></tr>
        <tr><td>Memória da placa (VRAM)</td><td>${R.vramMin} GB (clipe de 5 s em 832x480)</td><td>${R.vramBoa}–24 GB</td></tr>
        <tr><td>Memória RAM</td><td>${R.ramMin} GB (perfil 5, mais lento)</td><td>${R.ramBoa}–64 GB</td></tr>
        <tr><td>Espaço livre</td><td>${R.discoMin} GB</td><td>${R.discoBom} GB ou mais, em SSD</td></tr>
        <tr><td>Sistema</td><td colspan="2">Windows 10/11 (botão Instalar) ou Linux (terminal). Mac não roda.</td></tr>
        <tr><td>Programas</td><td colspan="2">Git. O instalador oferece instalar o Python 3.11 se faltar.</td></tr>
        <tr><td>Internet</td><td colspan="2">~3 GB do programa na instalação + ~33–42 GB do modelo no primeiro vídeo.</td></tr>
      </tbody>
    </table>
    <p class="ajuda">A placa e a RAM trabalham juntas: o que não cabe na placa fica na RAM. Placa pequena pede mais RAM. Numa RTX 3060 com 16 GB de RAM, um clipe de 5 s levou ~25 min.</p>`;

  const sit = g.noAr ? 'noar' : g.situacao;
  const rotuloSit = { ausente: 'Não instalado', baixado: 'Baixado, falta rodar o instalador', instalado: 'Instalado', noar: 'Rodando' }[sit];
  const botaoPrincipal = {
    ausente: '<button class="btn primario grande" id="gerInstalarBtn">⬇ Instalar</button>',
    baixado: '<button class="btn primario grande" id="gerInstalarBtn">⬇ Continuar instalação</button>',
    instalado: '<button class="btn primario grande" id="gerIniciar">▶ Iniciar o gerador</button>',
    noar: `<a class="btn primario grande" href="${esc(g.url)}" target="_blank" rel="noopener">↗ Abrir o gerador</a>`,
  }[sit];
  const windows = g.maquina.so === 'win32';
  $('#gerInstalar').innerHTML = `
    <div class="voz-linha"><h3>Instalar</h3><span class="espaco"></span><span class="ger-sit ${sit}">${rotuloSit}</span></div>
    <label>Pasta de instalação <small>(precisa de ~${R.discoBom} GB livres nesse disco)</small>
      <div class="voz-linha"><input id="gerPasta" value="${esc(g.pasta)}" spellcheck="false"><button class="btn" id="gerSalvarPasta">Usar esta pasta</button></div></label>
    ${windows ? `<div class="voz-linha">${botaoPrincipal}${g.situacao !== 'ausente' ? '<button class="btn" id="gerAbrirPasta">📁 Abrir pasta</button>' : ''}</div>`
    : `<p class="ajuda">No ${g.maquina.so === 'linux' ? 'Linux' : 'seu sistema'}, instale pelo terminal:</p>
       <pre class="ger-codigo">git clone ${'https://github.com/deepbeepmeep/Wan2GP.git'}\ncd Wan2GP\nbash scripts/install.sh\nbash scripts/run.sh</pre>`}
    <div id="gerProgresso" hidden><div class="ger-barra"><i></i></div><p class="ajuda mono" id="gerMsg"></p></div>
    <ol class="ger-passos">
      <li><b>Instalar</b> baixa o WanGP do GitHub oficial (deepbeepmeep/Wan2GP) para a pasta acima.</li>
      <li>Abre o instalador oficial numa janela preta. Digite <b>1</b> (Automatic Install) e Enter. Ele instala Python, PyTorch e o resto (10–20 min).</li>
      <li>Quando a janela terminar, volte aqui e clique em <b>Iniciar o gerador</b>. A interface abre em ${esc(g.url)}.</li>
      <li>No primeiro vídeo o WanGP baixa o modelo (~33–42 GB). Só dessa vez.</li>
    </ol>
    <details class="ger-alt"><summary>Prefere instalar pelo Pinokio?</summary>
      <ol class="ger-passos">
        <li>Baixe e instale o Pinokio: <a href="https://desktop.pinokio.co" target="_blank" rel="noopener">desktop.pinokio.co</a></li>
        <li>Abra o script do WanGP no Pinokio e clique em Install: <a href="https://pinokio.co/apps/github-com-6morpheus6-wan2gp" target="_blank" rel="noopener">Wan2GP do 6Morpheus6</a></li>
        <li>Clique em Start e abra pelo botão <b>Open Web UI</b>. Pelo Pinokio a porta muda a cada início, então use o botão dele.</li>
      </ol>
    </details>`;

  $('#gerGuia').innerHTML = `
    <h3>Primeiro vídeo</h3>
    <ol class="ger-passos">
      <li>No seletor de modelos, escolha <b>MiniMax H3 FL2VA Pruned 20B</b> (o mais leve).</li>
      <li>Marque <b>Advanced Mode</b> → aba <b>Misc</b>: Text Encoder <b>Qwen3-VL GGUF Q2_K</b> e VAE <b>FP8 Mixed Precision</b>.</li>
      <li>Em <b>Override Memory Profile</b>, use o perfil <b>${perfil}</b> (sua máquina tem ${ram} GB de RAM).</li>
      <li>Primeiro teste pequeno: <b>832x480</b>, <b>124 quadros</b> (~5 s) e <b>20 passos</b>.</li>
      <li>Cole o prompt abaixo, troque a fala pelo seu texto e clique em <b>Generate</b>. Depois, traga o vídeo para o Editor no quadro "Vídeos gerados".</li>
    </ol>
    <label>Prompt de exemplo (UGC com fala em português)
      <textarea id="gerPrompt" rows="9" class="mono" readonly>${esc(PROMPT_GERADOR)}</textarea></label>
    <div class="voz-linha"><button class="btn" id="gerCopiar">⧉ Copiar prompt</button></div>
    <p class="ajuda">A fala vai dentro de <code>&lt;d&gt;[Portuguese] …&lt;/d&gt;</code>, curta (~2,5 palavras por segundo). Para narração em off, escreva <i>says in an off-screen voiceover</i> e, logo depois da fala, <i>while her lips remain completely closed</i>.</p>
    <div class="ger-licenca">⚖ <b>Licença do MiniMax H3:</b> uso comercial sem royalties no Brasil (até US$ 20 milhões de receita por ano). Anúncio precisa de <b>aviso visível de que o vídeo foi gerado por IA</b>. Não use rosto ou voz de outra pessoa sem consentimento. Nos EUA, União Europeia, Reino Unido e Coreia do Sul a licença é paga.</div>`;

  $('#gerReverificar').onclick = abrirGerador;
  $('#gerSalvarPasta').onclick = async () => {
    try {
      const r = await api('/api/gerador/pasta', { method: 'PUT', corpo: { pasta: $('#gerPasta').value } });
      toast(`Pasta definida. Livre nesse disco: ${r.disco ?? '?'} GB.`, 'ok');
      abrirGerador();
    } catch (e) { toast(e.message, 'erro'); }
  };
  $('#gerCopiar').onclick = async () => {
    try { await navigator.clipboard.writeText(PROMPT_GERADOR); toast('Prompt copiado.', 'ok'); }
    catch { $('#gerPrompt').select(); document.execCommand('copy'); toast('Prompt copiado.', 'ok'); }
  };
  if ($('#gerAbrirPasta')) $('#gerAbrirPasta').onclick = () => api('/api/gerador/abrir-pasta', { method: 'POST' }).catch((e) => toast(e.message, 'erro'));
  if ($('#gerInstalarBtn')) $('#gerInstalarBtn').onclick = async () => {
    const falhas = g.itens.filter((i) => i.nivel === 'falha').map((i) => `• ${i.nome}: ${i.detalhe}`);
    if (falhas.length && !confirm(`Esta máquina não atende a:\n\n${falhas.join('\n')}\n\nInstalar mesmo assim?`)) return;
    try {
      const { job } = await api('/api/gerador/instalar', { method: 'POST' });
      acompanharInstalacao(job);
    } catch (e) { toast(e.message, 'erro'); }
  };
  if ($('#gerIniciar')) $('#gerIniciar').onclick = async () => {
    try {
      const r = await api('/api/gerador/iniciar', { method: 'POST' });
      toast(r.jaAberto ? 'O gerador já está rodando.' : 'Iniciando o gerador numa janela nova. A interface abre em alguns segundos.', 'ok');
      esperarGeradorNoAr();
    } catch (e) { toast(e.message, 'erro'); }
  };
}

function acompanharInstalacao(id) {
  const caixa = $('#gerProgresso');
  if (caixa) caixa.hidden = false;
  if ($('#gerInstalarBtn')) $('#gerInstalarBtn').disabled = true;
  acompanharJob(id, (j) => {
    const barra = $('#gerProgresso i');
    if (barra) barra.style.width = `${Math.round((j.progresso || 0) * 100)}%`;
    if ($('#gerMsg')) $('#gerMsg').textContent = j.ultima || 'preparando…';
  }).then((j) => {
    if (j.status === 'ok') toast('WanGP baixado. Siga na janela do instalador (escolha 1).', 'ok');
    else toast('Instalação: ' + (j.erro || 'falhou'), 'erro');
    if (estado.vista === 'gerador') abrirGerador();
  });
}

// depois de "Iniciar", espera a interface responder e troca o botão para "Abrir o gerador"
async function esperarGeradorNoAr() {
  for (let i = 0; i < 90 && estado.vista === 'gerador'; i++) {
    await new Promise((ok) => setTimeout(ok, 2000));
    const g = await api('/api/gerador/maquina').catch(() => null);
    if (g?.noAr) { gz.info = g; desenharGerador(); toast('Gerador no ar!', 'ok'); window.open(g.url, '_blank', 'noopener'); return; }
  }
}

async function carregarVideosGerador() {
  gz.videos = await api('/api/gerador/videos').catch(() => []);
  $('#gerVideos').innerHTML = `
    <div class="voz-linha"><h3>Vídeos gerados</h3><span class="espaco"></span><button class="btn mini" id="gerAtualizarVideos">⟳</button></div>
    ${gz.videos.length ? `<div class="ger-videos">${gz.videos.map((v) => `
      <div class="ger-video"><span class="mono">${esc(v.nome)}</span><small>${quando(v.criado)} · ${(v.tamanho / 1048576).toFixed(1)} MB</small>
        ${v.importado ? '<span class="ger-sit instalado">no Editor</span>' : `<button class="btn mini" data-importar="${esc(v.nome)}">➜ Editor</button>`}</div>`).join('')}</div>`
    : '<p class="ajuda">Os vídeos que o gerador salvar na pasta <span class="mono">outputs</span> aparecem aqui, prontos para ir ao Editor.</p>'}`;
  $('#gerAtualizarVideos').onclick = carregarVideosGerador;
  $$('#gerVideos [data-importar]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try {
      await api('/api/gerador/importar', { corpo: { nome: b.dataset.importar } });
      await carregarMidia();
      toast('Vídeo na Mídia do Editor.', 'ok');
      carregarVideosGerador();
    } catch (e) { b.disabled = false; toast(e.message, 'erro'); }
  });
}

function seguirHash() {
  const [vista, id] = location.hash.slice(1).split('/');
  if (vista === 'projetos' && id) abrirProjeto(id);
  else if (['modelos', 'projetos', 'voz', 'kie', 'gerador', 'editor'].includes(vista)) irPara(vista);
}
window.addEventListener('hashchange', seguirHash);

(async () => {
  await Promise.all([carregarStatus(), carregarModelos(), carregarEdicao(), carregarMidia()]);
  carregarProjetos();
  seguirHash();
})();
