const API_URL = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'nh_access_token';

async function request(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${API_URL}/informes-lavoura${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof data?.detail === 'string' ? data.detail : 'Falha ao consultar informes de saída.');
  }
  return data;
}

const json = (body) => ({ method: 'POST', body: JSON.stringify(body) });

export const informesLavouraApi = {
  referencias: () => request('/referencias'),
  minhas: () => request('/minhas'),
  solicitar: (dados) => request('', json(dados)),
  listaAdmin: () => request('/admin'),
  custosAdmin: () => request('/admin/custos'),
  editar: (id, dados) => request(`/admin/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(dados),
  }),
  aprovar: (id) => request(`/admin/${encodeURIComponent(id)}/aprovar`, json({})),
  recusar: (id, motivo) => request(`/admin/${encodeURIComponent(id)}/recusar`, json({ motivo })),
};
