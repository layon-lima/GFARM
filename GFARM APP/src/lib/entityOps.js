// Operações de entidade resilientes a registros fantasmas (restos do cache offline).
import { api } from '@/api/apiClient';
import { queryClientInstance } from '@/lib/query-client';

// Verifica se um erro é "entidade não encontrada" (registro fantasma do cache).
export function isNotFoundError(err) {
  return /not found/i.test(String(err?.message || err || ''));
}

// Busca dados frescos do backend e sobrescreve o cache do React Query
// usando a CHAVE EXATA de cada query ativa. Isto garante que a UI
// reflita exatamente o estado do backend, eliminando registros fantasmas.
async function syncCacheFromBackend(entityName, deletedId) {
  const cache = queryClientInstance.getQueryCache();
  const queries = cache.findAll({ queryKey: ['ent', entityName] });

  for (const query of queries) {
    const queryKey = query.queryKey;
    // keyOf = ['ent', name, sort, limit]
    const sort = queryKey[2];
    const limit = queryKey[3];

    try {
      const entity = api.entities[entityName];
      let fresh;
      if (sort && limit != null) fresh = await entity.list(sort, limit);
      else if (sort) fresh = await entity.list(sort);
      else fresh = await entity.list();

      // Sobrescreve o cache com os dados frescos usando a chave EXATA
      queryClientInstance.setQueryData(queryKey, fresh);
    } catch {
      // Fallback: update otimista (remove o registro deletado da lista em cache)
      const oldData = query.state.data;
      if (Array.isArray(oldData)) {
        queryClientInstance.setQueryData(queryKey, oldData.filter((r) => r.id !== deletedId));
      }
    }
  }
}

// Exclui uma entidade com tolerância a registros fantasmas (not found).
// Após excluir, busca dados frescos do backend e sobrescreve o cache.
// Lança qualquer outro erro (permissão, rede, etc.) para o caller tratar.
export async function safeDelete(entityName, id) {
  try {
    await api.entities[entityName].delete(id);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // Registro fantasma: já não existe no backend. Trata como sucesso.
  }
  await syncCacheFromBackend(entityName, id);
}

// Atualiza uma entidade com tolerância a registros fantasmas (not found).
// Se o registro não existe, sincroniza o cache e lança 'PHANTOM_RECORD'
// para o caller decidir como tratar.
export async function safeUpdate(entityName, id, data) {
  try {
    return await api.entities[entityName].update(id, data);
  } catch (err) {
    if (isNotFoundError(err)) {
      await syncCacheFromBackend(entityName, id);
      throw new Error('PHANTOM_RECORD');
    }
    throw err;
  }
}