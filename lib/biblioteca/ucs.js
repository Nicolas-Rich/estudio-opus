// Nomes no padrão UCS (Universal Category System), usado por bibliotecas profissionais como a Sonniss:
// CatID_Descrição_Criador_Fonte.wav — ex.: WHSHAir_Fast Swoosh Short_ACME_SFX.wav (família WHSH, sub Air).

/** Lê o nome UCS; null se o arquivo não segue o padrão. */
export function lerNomeUcs(nomeArquivo) {
  const base = String(nomeArquivo).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const partes = base.split('_');
  if (partes.length < 3) return null;
  const catId = partes[0];
  // família em maiúsculas + subcategoria Capitalizada (WHSHAir → WHSH + Air; UIClick → UI + Click),
  // ou só a família (AMB, AMB01)
  const m = /^([A-Z]{2,})[A-Z][a-z][A-Za-z0-9]*$/.exec(catId) || /^([A-Z]{2,})[0-9]*$/.exec(catId);
  if (!m) return null;
  return { catId, familia: m[1], descricao: partes[1].trim(), criador: partes[2].trim() };
}
