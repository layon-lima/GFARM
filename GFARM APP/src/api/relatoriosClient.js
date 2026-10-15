const API_URL =
  import.meta.env.VITE_API_URL ||
  '/api';

const TOKEN_KEY = 'nh_access_token';

async function request(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.detail ||
      data?.message ||
      'Erro ao carregar o relatório.'
    );
  }

  return data;
}

export const relatoriosApi = {
  catalogo() {
    return request('/relatorios/catalogo');
  },

  executar(codigo, parametros = {}) {
    return request(
      `/relatorios/${encodeURIComponent(codigo)}/executar`,
      {
        method: 'POST',
        body: JSON.stringify(parametros),
      }
    );
  },
};
