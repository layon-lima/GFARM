const API_URL =
  import.meta.env.VITE_API_URL ||
  "/api";

const TOKEN_KEY = "nh_access_token";


function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}


async function request(path, options = {}) {
  const token = getToken();

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
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
    const error = new Error(
      data?.detail ||
      data?.message ||
      `Erro ${response.status}`
    );

    error.status = response.status;
    throw error;
  }

  return data;
}


function queryString(sort, limit) {
  const params =
    new URLSearchParams();

  if (sort) {
    params.set(
      "sort",
      sort
    );
  }

  if (limit != null) {
    params.set(
      "limit",
      String(limit)
    );
  }

  const qs =
    params.toString();

  return qs
    ? `?${qs}`
    : "";
}


function ordenarLimitar(
  registros,
  sort,
  limit
) {
  let resultado = [
    ...(registros || []),
  ];

  if (sort) {
    const desc =
      sort.startsWith("-");

    const campo =
      desc
        ? sort.slice(1)
        : sort;

    resultado.sort((a, b) => {
      const av =
        a?.[campo];

      const bv =
        b?.[campo];

      if (av == null && bv == null) {
        return 0;
      }

      if (av == null) {
        return desc ? 1 : -1;
      }

      if (bv == null) {
        return desc ? -1 : 1;
      }

      if (av < bv) {
        return desc ? 1 : -1;
      }

      if (av > bv) {
        return desc ? -1 : 1;
      }

      return 0;
    });
  }

  if (limit != null) {
    resultado =
      resultado.slice(
        0,
        Number(limit)
      );
  }

  return resultado;
}


function aplicarFiltros(
  registros,
  filtros = {}
) {
  return (
    registros || []
  ).filter((registro) => {
    return Object.entries(
      filtros || {}
    ).every(
      ([campo, valor]) => {
        if (
          valor === undefined ||
          valor === null
        ) {
          return true;
        }

        return (
          String(
            registro?.[campo] ?? ""
          )
          ===
          String(valor)
        );
      }
    );
  });
}


function somenteLeitura(nome) {
  throw new Error(
    `${nome} não pode mais ser alterado diretamente. ` +
    "Utilize o motor oficial de estoque."
  );
}


function entityClient(name) {
  return {
    async list(sort, limit) {
      return request(
        `/entities/${encodeURIComponent(name)}` +
        queryString(sort, limit)
      );
    },

    async filter(
      filters = {},
      sort,
      limit
    ) {
      return request(
        `/entities/${encodeURIComponent(name)}/filter` +
        queryString(sort, limit),
        {
          method: "POST",
          body: JSON.stringify(
            filters
          ),
        }
      );
    },

    async get(id) {
      return request(
        `/entities/${encodeURIComponent(name)}/` +
        encodeURIComponent(id)
      );
    },

    async create(data) {
      return request(
        `/entities/${encodeURIComponent(name)}`,
        {
          method: "POST",
          body: JSON.stringify(
            data
          ),
        }
      );
    },

    async update(id, data) {
      return request(
        `/entities/${encodeURIComponent(name)}/` +
        encodeURIComponent(id),
        {
          method: "PATCH",
          body: JSON.stringify(
            data
          ),
        }
      );
    },

    async delete(id) {
      return request(
        `/entities/${encodeURIComponent(name)}/` +
        encodeURIComponent(id),
        {
          method: "DELETE",
        }
      );
    },

    async bulkUpdate(registros) {
      return request(
        `/entities/${encodeURIComponent(name)}/bulk-update`,
        {
          method: "POST",
          body: JSON.stringify(
            registros
          ),
        }
      );
    },

    subscribe() {
      return () => {};
    },
  };
}


function adaptarSaldo(saldo) {
  return {
    id: saldo.id,

    produto_id:
      saldo.produto_id,

    deposito_id:
      saldo.deposito_id,

    gaveta_id:
      saldo.gaveta_id || "",

    lote_id:
      saldo.lote_id || "",

    quantidade:
      Number(
        saldo.quantidade || 0
      ),

    quantidade_reservada:
      Number(
        saldo.quantidade_reservada
        || 0
      ),

    quantidade_disponivel:
      Number(
        saldo.quantidade_disponivel
        || 0
      ),

    custo_unitario:
      Number(
        saldo.custo_medio || 0
      ),

    custo_medio:
      Number(
        saldo.custo_medio || 0
      ),

    valor_total:
      Number(
        saldo.valor_total || 0
      ),

    tipo_estoque:
      saldo.tipo_estoque
      || "livre",
  };
}


const saldoEstoqueClient = {
  async list(sort, limit) {
    const saldos =
      await request(
        "/estoque/saldos"
      );

    return ordenarLimitar(
      saldos.map(
        adaptarSaldo
      ),
      sort,
      limit
    );
  },


  async filter(
    filters = {},
    sort,
    limit
  ) {
    const params =
      new URLSearchParams();

    if (filters.produto_id) {
      params.set(
        "produto_id",
        filters.produto_id
      );
    }

    if (filters.deposito_id) {
      params.set(
        "deposito_id",
        filters.deposito_id
      );
    }

    const query =
      params.toString();

    const saldos =
      await request(
        `/estoque/saldos${
          query
            ? `?${query}`
            : ""
        }`
      );

    const adaptados =
      saldos.map(
        adaptarSaldo
      );

    return ordenarLimitar(
      aplicarFiltros(
        adaptados,
        filters
      ),
      sort,
      limit
    );
  },


  async get(id) {
    const saldos =
      await this.list();

    const saldo =
      saldos.find(
        (item) =>
          item.id === id
      );

    if (!saldo) {
      throw new Error(
        "Saldo de estoque não encontrado."
      );
    }

    return saldo;
  },


  async create() {
    return somenteLeitura(
      "SaldoEstoque"
    );
  },

  async update() {
    return somenteLeitura(
      "SaldoEstoque"
    );
  },

  async delete() {
    return somenteLeitura(
      "SaldoEstoque"
    );
  },

  async bulkUpdate() {
    return somenteLeitura(
      "SaldoEstoque"
    );
  },

  subscribe() {
    return () => {};
  },
};


const TIPOS_ENTRADA =
  new Set([
    "ENTRADA_COMPRA",
    "DEVOLUCAO_ENTRADA",
    "AJUSTE_POSITIVO",
    "ENTRADA_SALDO_ADMIN",
  ]);


const TIPOS_SAIDA =
  new Set([
    "SAIDA_CONSUMO",
    "DEVOLUCAO_SAIDA",
    "AJUSTE_NEGATIVO",
    "ABASTECIMENTO",
    "APLICACAO",
  ]);


function movimentoBase(
  documento,
  item,
  produto
) {
  return {
    documento_id:
      documento.id,

    numero:
      documento.numero,

    tipo_movimento:
      documento.tipo_movimento,

    data:
      documento.data_documento,

    created_date:
      documento.data_documento,

    updated_date:
      documento.contabilizado_em
      || documento.data_documento,

    created_by_id:
      documento.usuario_id,

    produto_id:
      item.produto_id,

    codigo:
      produto?.codigo || "",

    nome_produto:
      produto?.nome || "",

    setor_id:
      produto?.setor_id || "",

    maquina_id:
      produto?.maquina_id || "",

    quantidade:
      Number(
        item.quantidade || 0
      ),

    unidade:
      item.unidade
      || produto?.unidade
      || "",

    custo_unitario:
      Number(
        item.custo_unitario || 0
      ),

    valor_movimentado:
      Number(
        item.valor_total || 0
      ),

    modulo:
      documento.origem_modulo
      || "estoque",

    observacao:
      item.observacao
      || documento.observacao
      || "",

    referencia_externa:
      documento.referencia_externa
      || "",

    estornada:
      documento.status
      === "estornado",

    estorno_de:
      documento.estorno_de_id
      || "",

    status_documento:
      documento.status,
  };
}


function adaptarDocumento(
  documento,
  produtosMap
) {
  const linhas = [];

  for (
    const item
    of documento.itens || []
  ) {
    const produto =
      produtosMap.get(
        item.produto_id
      );

    const base =
      movimentoBase(
        documento,
        item,
        produto
      );

    if (
      documento.tipo_movimento
      === "TRANSFERENCIA"
    ) {
      linhas.push({
        ...base,

        id:
          `${documento.id}:SAIDA:${item.id}`,

        tipo: "saida",

        deposito_id:
          item.deposito_origem_id
          || "",

        gaveta_id:
          item.gaveta_origem_id
          || "",

        lote_id:
          item.lote_origem_id
          || "",
      });

      linhas.push({
        ...base,

        id:
          `${documento.id}:ENTRADA:${item.id}`,

        tipo: "entrada",

        deposito_id:
          item.deposito_destino_id
          || "",

        gaveta_id:
          item.gaveta_destino_id
          || "",

        lote_id:
          item.lote_destino_id
          || "",
      });

      continue;
    }


    if (
      documento.tipo_movimento
      === "ESTORNO"
    ) {
      linhas.push({
        ...base,

        id:
          `${documento.id}:ESTORNO:${item.id}`,

        tipo: "estorno",

        deposito_id:
          item.deposito_origem_id
          ||
          item.deposito_destino_id
          || "",

        gaveta_id:
          item.gaveta_origem_id
          ||
          item.gaveta_destino_id
          || "",

        lote_id:
          item.lote_origem_id
          ||
          item.lote_destino_id
          || "",
      });

      continue;
    }


    if (
      TIPOS_ENTRADA.has(
        documento.tipo_movimento
      )
    ) {
      linhas.push({
        ...base,

        id:
          `${documento.id}:ENTRADA:${item.id}`,

        tipo: "entrada",

        deposito_id:
          item.deposito_destino_id
          || "",

        gaveta_id:
          item.gaveta_destino_id
          || "",

        lote_id:
          item.lote_destino_id
          || "",
      });

      continue;
    }


    if (
      TIPOS_SAIDA.has(
        documento.tipo_movimento
      )
    ) {
      linhas.push({
        ...base,

        id:
          `${documento.id}:SAIDA:${item.id}`,

        tipo: "saida",

        deposito_id:
          item.deposito_origem_id
          || "",

        gaveta_id:
          item.gaveta_origem_id
          || "",

        lote_id:
          item.lote_origem_id
          || "",
      });
    }
  }

  return linhas;
}


async function carregarMovimentos() {
  const [
    documentos,
    produtos,
  ] = await Promise.all([
    request(
      "/estoque/documentos?limit=500"
    ),

    entityClient(
      "Produto"
    ).list(),
  ]);

  const produtosMap =
    new Map(
      produtos.map(
        (produto) => [
          produto.id,
          produto,
        ]
      )
    );

  return documentos.flatMap(
    (documento) =>
      adaptarDocumento(
        documento,
        produtosMap
      )
  );
}


const movimentacaoClient = {
  async list(sort, limit) {
    const movimentos =
      await carregarMovimentos();

    return ordenarLimitar(
      movimentos,
      sort,
      limit
    );
  },


  async filter(
    filters = {},
    sort,
    limit
  ) {
    const movimentos =
      await carregarMovimentos();

    return ordenarLimitar(
      aplicarFiltros(
        movimentos,
        filters
      ),
      sort,
      limit
    );
  },


  async get(id) {
    const documentoId =
      String(id)
      .split(":")[0];

    const documento =
      await request(
        `/estoque/documentos/${encodeURIComponent(documentoId)}`
      );

    const produtos =
      await entityClient(
        "Produto"
      ).list();

    const produtosMap =
      new Map(
        produtos.map(
          (produto) => [
            produto.id,
            produto,
          ]
        )
      );

    const movimentos =
      adaptarDocumento(
        documento,
        produtosMap
      );

    return (
      movimentos.find(
        (movimento) =>
          movimento.id === id
      )
      ||
      movimentos[0]
    );
  },


  async create() {
    return somenteLeitura(
      "Movimentacao"
    );
  },

  async update() {
    return somenteLeitura(
      "Movimentacao"
    );
  },

  async delete() {
    return somenteLeitura(
      "Movimentacao"
    );
  },

  async bulkUpdate() {
    return somenteLeitura(
      "Movimentacao"
    );
  },

  subscribe() {
    return () => {};
  },
};


const userEntityClient = {
  async list() {
    return request(
      "/users"
    );
  },

  async get(id) {
    return request(
      `/users/${encodeURIComponent(id)}`
    );
  },

  async create(data) {
    return request(
      "/users",
      {
        method: "POST",
        body: JSON.stringify(
          data
        ),
      }
    );
  },

  async update(id, data) {
    return request(
      `/users/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(
          data
        ),
      }
    );
  },

  async updatePermissions(id, data) {
    return request(
      `/users/${encodeURIComponent(id)}/permissions`,
      {
        method: "PUT",
        body: JSON.stringify(
          data
        ),
      }
    );
  },

  async permissionsCatalog() {
    return request(
      "/users/permissions/catalog"
    );
  },

  async delete(id) {
    return request(
      `/users/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      }
    );
  },

  subscribe() {
    return () => {};
  },
};


const entities =
  new Proxy(
    {},
    {
      get(
        _target,
        prop
      ) {
        if (
          typeof prop
          !== "string"
        ) {
          return undefined;
        }

        if (
          prop === "User"
        ) {
          return userEntityClient;
        }

        if (prop === 'InventarioForaEstoque') {
          return {
            list: () => request('/inventario-pendencias'),
            create: (data) => request('/inventario-pendencias', { method: 'POST', body: JSON.stringify(data) }),
            revisar: (id, data) => request(`/inventario-pendencias/${encodeURIComponent(id)}/revisar`, { method: 'POST', body: JSON.stringify(data) }),
            subscribe: () => () => {},
          };
        }

        if (
          prop === "SaldoEstoque"
        ) {
          return saldoEstoqueClient;
        }

        if (
          prop === "Movimentacao"
        ) {
          return movimentacaoClient;
        }

        return entityClient(
          prop
        );
      },
    }
  );


async function uploadFile(file) {
  const token =
    getToken();

  const formData =
    new FormData();

  formData.append(
    "file",
    file
  );

  const headers = {};

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const response =
    await fetch(
      `${API_URL}/files/upload`,
      {
        method: "POST",
        headers,
        body: formData,
      }
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.detail ||
      data?.message ||
      `Erro ${response.status}`
    );
  }

  return data;
}


export const api = {
  entities,

  integrations: {
    Core: {
      async UploadFile({
        file,
      }) {
        return uploadFile(
          file
        );
      },
    },
  },

  auth: {
    async loginViaEmailPassword(
      username,
      password
    ) {
      const result =
        await request(
          "/auth/login",
          {
            method: "POST",
            body: JSON.stringify({
              username,
              password,
            }),
          }
        );

      localStorage.setItem(
        TOKEN_KEY,
        result.access_token
      );

      return result.user;
    },

    hasToken() {
      return !!getToken();
    },

    clearToken() {
      localStorage.removeItem(
        TOKEN_KEY
      );
    },

    async isAuthenticated() {
      if (!getToken()) {
        return false;
      }

      try {
        await request(
          "/auth/me"
        );

        return true;

      } catch (error) {
        if (
          error?.status === 401
          || error?.status === 403
        ) {
          localStorage.removeItem(
            TOKEN_KEY
          );
        }

        return false;
      }
    },

    async me() {
      return request(
        "/auth/me"
      );
    },

    async updateMe(data) {
      return request(
        "/auth/me",
        {
          method: "PATCH",
          body: JSON.stringify(
            data
          ),
        }
      );
    },

    logout() {
      localStorage.removeItem(
        TOKEN_KEY
      );

      window.location.href =
        "/login";
    },

    redirectToLogin() {
      window.location.href =
        "/login";
    },
  },

  users: {
    async createUser(data) {
      return request(
        "/users",
        {
          method: "POST",
          body: JSON.stringify(
            data
          ),
        }
      );
    },
  },
};
