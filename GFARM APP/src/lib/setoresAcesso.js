// Define quais setores aparecem no mobile.
// Administradores enxergam todos os setores.
// Usuários padrão enxergam somente os IDs gravados em setores_permitidos.
export function setoresAcessiveis(setores, user) {
  if (!user) return [];

  const lista = Array.isArray(setores) ? setores : [];

  if (user.role === 'admin') {
    return lista;
  }

  const permitidos = Array.isArray(user.setores_permitidos)
    ? user.setores_permitidos
    : [];

  const idsPermitidos = new Set(permitidos);

  return lista.filter((setor) => idsPermitidos.has(setor.id));
}
