const API_URL = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'nh_access_token';

async function request(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail || data?.message || `Erro ${response.status}`);
  }

  return data;
}

export const entradaSaldoMobileApi = {
  criar(dados) {
    return request('/entrada-saldo-mobile', {
      method: 'POST',
      body: JSON.stringify(dados),
    });
  },

  minhas() {
    return request('/entrada-saldo-mobile/minhas');
  },

  listar(status = 'PENDENTE') {
    return request(
      `/entrada-saldo-mobile${status ? `?status=${encodeURIComponent(status)}` : ''}`
    );
  },

  contador() {
    return request('/entrada-saldo-mobile/contador');
  },

  aprovar(id, dados) {
    return request(`/entrada-saldo-mobile/${encodeURIComponent(id)}/aprovar`, {
      method: 'POST',
      body: JSON.stringify(dados),
    });
  },

  rejeitar(id, motivo) {
    return request(`/entrada-saldo-mobile/${encodeURIComponent(id)}/rejeitar`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
    });
  },
};
