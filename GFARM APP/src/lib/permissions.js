// Fonte de leitura de permissões no frontend.
// O backend e a tabela user_permissions são a autoridade real.
export const PAGES = [
  { key: 'dashboard', label: 'Pesquisa', path: '/' },
  { key: 'movimentacoes', label: 'Movimentos', path: '/movimentacoes' },
  { key: 'abastecimento', label: 'Abastecimento', path: '/abastecimento' },
  { key: 'pesagem', label: 'Pesagem', path: '/pesagem' },
  { key: 'aplicacao', label: 'Aplicação', path: '/aplicacao' },
  { key: 'cadastros', label: 'Cadastros', path: '/cadastros' },
  { key: 'relatorios', label: 'Relatórios', path: '/relatorios' },
  { key: 'inventario', label: 'Inventário', path: '/inventario' },
];

export const USUARIOS_PATH = '/usuarios';

export const pageKeyForPath = (pathname) => {
  if (!pathname) return null;
  if (pathname === '/' || pathname === '') return 'dashboard';
  const found = PAGES.find((p) => p.path !== '/' && pathname.startsWith(p.path));
  return found ? found.key : null;
};

export const hasPermission = (user, permissionKey) => {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const permissions = user.permissoes;
  if (Array.isArray(permissions)) {
    return permissions.includes('*') || permissions.includes(permissionKey);
  }

  // Compatibilidade temporária com sessões antigas durante a atualização.
  if (permissionKey.startsWith('page.')) {
    const pageKey = permissionKey.slice(5);
    const allowed = user.paginas_permitidas;
    return !Array.isArray(allowed) || allowed.includes(pageKey);
  }

  const legacy = {
    'operacao.abastecimento.confirmar': 'pode_confirmar_abastecimento',
    'operacao.pesagem.digitar_peso': 'pode_digitar_peso',
    'mobile.estoque.baixar': 'pode_baixar_mobile',
    'mobile.estoque.mudar_gaveta': 'pode_mudar_gaveta_mobile',
    'mobile.estoque.mudar_deposito': 'pode_mudar_deposito_mobile',
    'mobile.estoque.entrada_manual_saldo': 'pode_entrada_manual_saldo_mobile',
  };

  const field = legacy[permissionKey];
  return field ? user?.[field] === true : false;
};

export const hasAnyPermission = (user, permissionKeys = []) =>
  permissionKeys.some((key) => hasPermission(user, key));

export const userCanAccess = (user, pageKey) => {
  if (!user) return false;
  if (!pageKey) return true;
  return hasPermission(user, `page.${pageKey}`);
};

export const allowedPagesForUser = (user) => {
  if (!user) return [];
  return PAGES.filter((page) =>
    hasPermission(user, `page.${page.key}`)
  );
};

export const canAccessUsuarios = (user) =>
  hasAnyPermission(user, [
    'admin.usuarios.visualizar',
    'admin.usuarios.criar',
    'admin.usuarios.editar',
    'admin.usuarios.excluir',
  ]);

export const canAccessBalanca = (user) =>
  hasPermission(user, 'admin.balanca.acessar');

export const canAccessAplicacao = (user) =>
  userCanAccess(user, 'aplicacao');

export const podeDigitarPeso = (user) =>
  hasPermission(user, 'operacao.pesagem.digitar_peso');

export const isAdminTotal = (user) =>
  user?.role === 'admin';

export const isSubAdmin = (user) =>
  user?.role === 'subadmin';

export const roleLabel = (role) => {
  if (role === 'admin') return 'Administrador Total';
  if (role === 'subadmin') return 'Sub Administrador';
  return 'Usuário';
};
