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
  if (!response.ok) throw new Error(data?.detail || `Erro ${response.status}`);
  return data;
}

export const cadastrosMobileApi = {
  listar(status) {
    return request(`/cadastros-mobile${status ? `?status=${status}` : ''}`);
  },

  contador() {
    return request('/cadastros-mobile/contador');
  },

  criar(tipo, dados, imagemUrl = null) {
    return request('/cadastros-mobile', {
      method: 'POST',
      body: JSON.stringify({ tipo, dados, imagem_url: imagemUrl }),
    });
  },

  aprovar(id, dados) {
    return request(`/cadastros-mobile/${encodeURIComponent(id)}/aprovar`, {
      method: 'POST',
      body: JSON.stringify({ dados }),
    });
  },

  rejeitar(id, motivo) {
    return request(`/cadastros-mobile/${encodeURIComponent(id)}/rejeitar`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
    });
  },

  removerImagemTemporaria(url) {
    return request(
      `/cadastros-mobile/imagem-temporaria?url=${encodeURIComponent(url)}`,
      { method: 'DELETE' }
    );
  },
};
