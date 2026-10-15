const API_URL =
  import.meta.env.VITE_API_URL ||
  '/api';

const TOKEN_KEY =
  'nh_access_token';


async function request(
  path,
  options = {}
) {
  const token =
    localStorage.getItem(
      TOKEN_KEY
    );

  const headers = {
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const response = await fetch(
    `${API_URL}${path}`,
    {
      ...options,
      headers,
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.detail
      || 'Erro ao consultar administração.'
    );
  }

  return data;
}


export const adminApi = {
  integridade() {
    return request(
      '/admin/integridade'
    );
  },

  auditoria(limit = 30) {
    return request(
      `/admin/auditoria?limit=${limit}`
    );
  },


  backups() {
    return request(
      '/admin/backups'
    );
  },

  criarBackup() {
    return request(
      '/admin/backup',
      {
        method: 'POST',
      }
    );
  },

  verificarBackup(nome) {
    return request(
      `/admin/backups/${encodeURIComponent(nome)}/verificar`,
      {
        method: 'POST',
      }
    );
  },

  verificarIntegridade() {
    return request(
      '/admin/verificar-consistencia-estoque',
      {
        method: 'POST',
      }
    );
  },
};
