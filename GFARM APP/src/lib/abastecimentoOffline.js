import { api } from '@/api/apiClient';

const DB_NAME = 'estoque-nh-offline';
const DB_VERSION = 2;
const STORE_NAME = 'abastecimentos_pendentes';
const DRAFT_STORE_NAME = 'abastecimento_rascunho';

let dbPromise = null;
let syncPromise = null;

function abrirBanco() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(
      new Error('Armazenamento offline indisponível neste aparelho.')
    );
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(
          STORE_NAME,
          { keyPath: 'id' }
        );

        store.createIndex(
          'created_at',
          'created_at',
          { unique: false }
        );

        store.createIndex(
          'user_id',
          'user_id',
          { unique: false }
        );
      }

      if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        db.createObjectStore(
          DRAFT_STORE_NAME,
          { keyPath: 'user_id' }
        );
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error
      || new Error('Não foi possível abrir o armazenamento offline.')
    );
  });

  return dbPromise;
}

async function executarStore(mode, callback) {
  const db = await abrirBanco();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);

    let result;

    try {
      result = callback(store);
    } catch (error) {
      reject(error);
      return;
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(
      tx.error
      || new Error('Falha no armazenamento offline.')
    );
    tx.onabort = () => reject(
      tx.error
      || new Error('Operação offline cancelada.')
    );
  });
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error
      || new Error('Falha ao ler o armazenamento offline.')
    );
  });
}

async function salvarRegistro(registro) {
  await executarStore(
    'readwrite',
    (store) => {
      store.put(registro);
    }
  );

  return registro;
}

async function obterRegistro(id) {
  const db = await abrirBanco();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(
      request.error
      || new Error('Falha ao consultar o armazenamento offline.')
    );
  });
}

async function listarRegistros() {
  const db = await abrirBanco();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const request = tx.objectStore(STORE_NAME).getAll();
  const rows = await requestPromise(request);

  return (rows || []).slice().sort(
    (a, b) =>
      String(a.created_at || '').localeCompare(
        String(b.created_at || '')
      )
  );
}

async function excluirRegistro(id) {
  await executarStore(
    'readwrite',
    (store) => {
      store.delete(id);
    }
  );
}

function novoId() {
  if (
    typeof crypto !== 'undefined'
    && typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return [
    'offline',
    Date.now(),
    Math.random().toString(16).slice(2),
  ].join('-');
}

function arquivoDaFoto(registro) {
  if (!registro?.foto_blob) return null;

  if (registro.foto_blob instanceof File) {
    return registro.foto_blob;
  }

  return new File(
    [registro.foto_blob],
    registro.foto_nome || 'abastecimento.jpg',
    {
      type:
        registro.foto_tipo
        || registro.foto_blob.type
        || 'image/jpeg',
    }
  );
}

export async function salvarAbastecimentoOffline({
  maquina,
  produto,
  quantidade,
  observacao,
  operador,
  fotoFile,
  userId,
}) {
  const qtd = Number(quantidade);

  if (!maquina?.id || !produto?.id) {
    throw new Error(
      'Máquina ou combustível não disponíveis para o lançamento.'
    );
  }

  if (!(qtd > 0)) {
    throw new Error(
      'Informe uma quantidade maior que zero.'
    );
  }

  const id = novoId();
  const agora = new Date().toISOString();

  const registro = {
    id,
    user_id: String(userId || ''),
    created_at: agora,
    data: agora,
    maquina_id: maquina.id,
    produto_id: produto.id,
    quantidade: qtd,
    unidade: produto.unidade || 'un',
    operador: operador || '',
    observacao: observacao || '',
    foto_url: '',
    foto_blob: fotoFile || null,
    foto_nome: fotoFile?.name || '',
    foto_tipo: fotoFile?.type || '',
  };

  await salvarRegistro(registro);

  return registro;
}

async function sincronizarRegistro(registro) {
  let atual = registro;

  if (atual.foto_blob && !atual.foto_url) {
    const file = arquivoDaFoto(atual);
    const upload = await api.integrations.Core.UploadFile({
      file,
    });

    atual = {
      ...atual,
      foto_url: upload.file_url || '',
    };

    await salvarRegistro(atual);
  }

  await api.entities.Abastecimento.create({
    id: atual.id,
    data: atual.data,
    maquina_id: atual.maquina_id,
    produto_id: atual.produto_id,
    quantidade: Number(atual.quantidade),
    unidade: atual.unidade || 'un',
    operador: atual.operador || '',
    observacao: atual.observacao || '',
    foto_url: atual.foto_url || '',
    status: 'pendente',
  });

  await excluirRegistro(atual.id);
}

export async function salvarRascunhoAbastecimento({
  userId,
  maquinaId,
  produtoId,
  quantidade,
  observacao,
  fotoFile,
}) {
  if (!userId || !maquinaId) return;

  const db = await abrirBanco();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(
      DRAFT_STORE_NAME,
      'readwrite'
    );

    tx.objectStore(DRAFT_STORE_NAME).put({
      user_id: String(userId),
      maquina_id: maquinaId,
      produto_id: produtoId || '',
      quantidade: quantidade || '',
      observacao: observacao || '',
      foto_blob: fotoFile || null,
      foto_nome: fotoFile?.name || '',
      foto_tipo: fotoFile?.type || '',
      updated_at: new Date().toISOString(),
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(
      tx.error
      || new Error('Falha ao preservar o abastecimento em andamento.')
    );
  });
}

export async function carregarRascunhoAbastecimento({
  userId,
  maquinaId,
}) {
  if (!userId || !maquinaId) return null;

  try {
    const db = await abrirBanco();

    const registro = await new Promise((resolve, reject) => {
      const tx = db.transaction(
        DRAFT_STORE_NAME,
        'readonly'
      );
      const request = tx
        .objectStore(DRAFT_STORE_NAME)
        .get(String(userId));

      request.onsuccess = () =>
        resolve(request.result || null);

      request.onerror = () =>
        reject(request.error);
    });

    if (
      !registro
      || String(registro.maquina_id)
        !== String(maquinaId)
    ) {
      return null;
    }

    return registro;
  } catch {
    return null;
  }
}

export async function limparRascunhoAbastecimento({
  userId,
}) {
  if (!userId) return;

  try {
    const db = await abrirBanco();

    await new Promise((resolve, reject) => {
      const tx = db.transaction(
        DRAFT_STORE_NAME,
        'readwrite'
      );

      tx.objectStore(DRAFT_STORE_NAME)
        .delete(String(userId));

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Rascunho auxiliar: falha de limpeza não bloqueia o fluxo.
  }
}


export async function contarAbastecimentosOffline({
  userId,
} = {}) {
  try {
    const registros = await listarRegistros();

    return registros.filter((registro) => {
      if (!userId) return true;

      return (
        !registro.user_id
        || String(registro.user_id) === String(userId)
      );
    }).length;
  } catch {
    return 0;
  }
}

const CATALOGO_KEY = 'abast:offline:catalogo:v1';

export function salvarCatalogoAbastecimento({
  maquinas = [],
  produtos = [],
  setores = [],
}) {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(
      CATALOGO_KEY,
      JSON.stringify({
        saved_at: new Date().toISOString(),
        maquinas: maquinas.map((item) => ({
          id: item.id,
          codigo: item.codigo || '',
          nome: item.nome || '',
          permite_abastecimento:
            item.permite_abastecimento === true,
          combustivel_id: item.combustivel_id || '',
        })),
        produtos: produtos.map((item) => ({
          id: item.id,
          codigo: item.codigo || '',
          nome: item.nome || '',
          unidade: item.unidade || 'un',
          quantidade: Number(item.quantidade || 0),
          setor_id: item.setor_id || '',
        })),
        setores: setores.map((item) => ({
          id: item.id,
          nome: item.nome || '',
        })),
      })
    );
  } catch {
    // Cache auxiliar: nunca bloqueia o fluxo principal.
  }
}

export function carregarCatalogoAbastecimento() {
  if (typeof localStorage === 'undefined') {
    return {
      maquinas: [],
      produtos: [],
      setores: [],
    };
  }

  try {
    const raw = localStorage.getItem(CATALOGO_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    return {
      maquinas: Array.isArray(parsed?.maquinas)
        ? parsed.maquinas
        : [],
      produtos: Array.isArray(parsed?.produtos)
        ? parsed.produtos
        : [],
      setores: Array.isArray(parsed?.setores)
        ? parsed.setores
        : [],
    };
  } catch {
    return {
      maquinas: [],
      produtos: [],
      setores: [],
    };
  }
}


export async function sincronizarAbastecimentosOffline({
  userId,
} = {}) {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    if (
      typeof navigator !== 'undefined'
      && navigator.onLine === false
    ) {
      return {
        synced: 0,
        pending: 0,
        offline: true,
      };
    }

    const registros = await listarRegistros();

    const doUsuario = registros.filter((registro) => {
      if (!userId) return true;

      return (
        !registro.user_id
        || String(registro.user_id) === String(userId)
      );
    });

    let synced = 0;
    let error = null;

    for (const registro of doUsuario) {
      try {
        await sincronizarRegistro(registro);
        synced += 1;
      } catch (err) {
        error = err;
        break;
      }
    }

    const restantes = await listarRegistros();
    const pending = restantes.filter((registro) => {
      if (!userId) return true;

      return (
        !registro.user_id
        || String(registro.user_id) === String(userId)
      );
    }).length;

    if (
      synced > 0
      && typeof window !== 'undefined'
    ) {
      window.dispatchEvent(
        new CustomEvent(
          'abastecimento:offline-synced',
          {
            detail: { synced },
          }
        )
      );
    }

    return {
      synced,
      pending,
      offline: false,
      error,
    };
  })();

  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}

export async function registrarAbastecimentoMobileSeguro({
  maquina,
  produto,
  quantidade,
  observacao,
  operador,
  fotoFile,
  userId,
}) {
  const registro = await salvarAbastecimentoOffline({
    maquina,
    produto,
    quantidade,
    observacao,
    operador,
    fotoFile,
    userId,
  });

  try {
    await sincronizarAbastecimentosOffline({
      userId,
    });
  } catch {
    // O registro fica preservado até a próxima tentativa automática.
    // A próxima abertura/retomada do app tentará novamente.
  }

  const aindaPendente = await obterRegistro(
    registro.id
  );

  return {
    id: registro.id,
    sincronizado: !aindaPendente,
  };
}
