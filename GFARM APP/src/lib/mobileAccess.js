// No mobile, inclusive o admin respeita paginas_permitidas quando a lista foi configurada.
// Ausência da lista mantém compatibilidade: acesso liberado.
export function mobilePageAllowed(user, pageKey) {
  if (!user) return false;

  // Pesagem é uma operação exclusiva do desktop.
  // Mantém a permissão desktop intacta, mas nunca expõe a aba/atalho no mobile.
  if (pageKey === 'pesagem') return false;

  const allowed = user.paginas_permitidas;
  if (!Array.isArray(allowed)) return true;
  return allowed.includes(pageKey);
}

export function mobileStockActions(user) {
  if (!user) return [];

  if (user.role === 'admin') {
    return ['baixar', 'mudar_gaveta', 'mudar_deposito'];
  }

  return [
    user.pode_baixar_mobile ? 'baixar' : null,
    user.pode_mudar_gaveta_mobile ? 'mudar_gaveta' : null,
    user.pode_mudar_deposito_mobile ? 'mudar_deposito' : null,
  ].filter(Boolean);
}
