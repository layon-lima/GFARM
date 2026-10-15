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

  if (
    options.body &&
    !(options.body instanceof FormData)
  ) {
    headers['Content-Type'] = 'application/json';
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
    const mensagem =
      data?.detail ||
      data?.message ||
      'Erro ao comunicar com o servidor.';

    throw new Error(mensagem);
  }

  return data;
}


function query(filtros = {}) {
  const params = new URLSearchParams();

  for (const [chave, valor] of Object.entries(filtros)) {
    if (
      valor !== undefined &&
      valor !== null &&
      valor !== ''
    ) {
      params.set(chave, String(valor));
    }
  }

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}


export const estoqueApi = {
  entradaManual(dados) {
    return request(
      '/estoque/entrada-manual',
      {
        method: 'POST',
        body: JSON.stringify(dados),
      }
    );
  },

  movimentar(dados) {
    return request(
      '/estoque/movimentar',
      {
        method: 'POST',
        body: JSON.stringify(dados),
      }
    );
  },

  listarSaldos(filtros = {}) {
    return request(
      `/estoque/saldos${query(filtros)}`
    );
  },

  listarDocumentos(limit = 100) {
    return request(
      `/estoque/documentos${query({ limit })}`
    );
  },

  buscarDocumentos(filtros = {}) {
    return request(
      `/estoque/documentos${query({
        limit: filtros.limit ?? 100,
        origem_modulo: filtros.origem_modulo,
        documento_origem_id: filtros.documento_origem_id,
        referencia_externa: filtros.referencia_externa,
        tipo_movimento: filtros.tipo_movimento,
        status: filtros.status,
      })}`
    );
  },

  obterDocumento(id) {
    return request(
      `/estoque/documentos/${encodeURIComponent(id)}`
    );
  },

  estornarDocumento(id, motivo) {
    return request(
      `/estoque/documentos/${encodeURIComponent(id)}/estornar`,
      {
        method: 'POST',
        body: JSON.stringify({
          motivo,
        }),
      }
    );
  },

  criarReserva(dados) {
    return request(
      '/estoque/reservas',
      {
        method: 'POST',
        body: JSON.stringify(dados),
      }
    );
  },

  consumirReserva(id, dados) {
    return request(
      `/estoque/reservas/${encodeURIComponent(id)}/consumir`,
      {
        method: 'POST',
        body: JSON.stringify(dados),
      }
    );
  },

  cancelarReserva(id, motivo) {
    return request(
      `/estoque/reservas/${encodeURIComponent(id)}/cancelar`,
      {
        method: 'POST',
        body: JSON.stringify({
          motivo,
        }),
      }
    );
  },
};