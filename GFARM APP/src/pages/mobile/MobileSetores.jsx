import { useMemo, useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useEntidades } from '@/lib/useEntidades';
import { filterProdutos } from '@/lib/estoqueFilters';
import { setoresAcessiveis } from '@/lib/setoresAcesso';
import SetorIcon from '@/components/setorIcon';

const FILTROS_VAZIOS = {
  setor_id: [], estoque: '', deposito_id: [], maquina_id: [], gaveta_id: [],
  unidade: [], codigo: '', referencia: '', quantidade_min: '', quantidade_max: '',
  valor_unit_min: '', valor_unit_max: '', valor_total_min: '', valor_total_max: '',
};

export default function MobileSetores() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');

  const { data, loading } = useEntidades({
    Setor: {},
    Produto: {},
    SaldoEstoque: {},
  });

  const setores = data.Setor || [];
  const produtos = data.Produto || [];
  const saldos = data.SaldoEstoque || [];

  const produtosComSaldo = useMemo(
    () => filterProdutos(produtos, FILTROS_VAZIOS, saldos),
    [produtos, saldos]
  );

  const setoresVisiveis = useMemo(
    () => setoresAcessiveis(setores, user),
    [setores, user]
  );

  const filtrados = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase('pt-BR');
    if (!q) return setoresVisiveis;
    return setoresVisiveis.filter((s) =>
      [s.nome, s.descricao].join(' ').toLocaleLowerCase('pt-BR').includes(q)
    );
  }, [busca, setoresVisiveis]);

  return (
    <div className="mobile-page">
      <section className="mobile-page-intro">
        <span className="mobile-eyebrow">Pesquisa por setor</span>
        <h1>Setores</h1>
        <p>Acesse apenas as áreas liberadas para o seu usuário.</p>
      </section>

      <div className="mobile-search-box">
        <Search className="h-5 w-5" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar setor..."
          aria-label="Buscar setor"
        />
      </div>

      {loading ? (
        <div className="mobile-loading-card">Carregando setores...</div>
      ) : filtrados.length === 0 ? (
        <div className="mobile-empty-state">
          <ShieldCheck className="h-7 w-7" />
          <strong>Nenhum setor encontrado</strong>
          <span>Verifique a pesquisa ou as permissões do usuário.</span>
        </div>
      ) : (
        <div className="mobile-sector-list">
          {filtrados.map((setor) => {
            const itens = produtosComSaldo.filter((p) => p.setor_id === setor.id);
            const criticos = itens.filter((p) => {
              const min = Number(p.estoque_minimo) || 0;
              return min > 0 && (Number(p.quantidade) || 0) <= min;
            }).length;

            return (
              <button
                type="button"
                key={setor.id}
                className="mobile-sector-row"
                onClick={() => navigate(`/setor/${setor.id}`)}
              >
                <span
                  className="mobile-sector-row__icon"
                  style={{
                    color: setor.cor || '#0f8b68',
                    backgroundColor: `${setor.cor || '#0f8b68'}14`,
                  }}
                >
                  <SetorIcon setor={setor} className="h-7 w-7" />
                </span>

                <span className="min-w-0 flex-1 text-left">
                  <strong>{setor.nome}</strong>
                  <small>
                    {itens.length} produto(s)
                    {setor.controla_validade ? ' · controla validade' : ''}
                  </small>
                </span>

                <span className="mobile-sector-row__meta">
                  {criticos > 0 ? <b>{criticos}</b> : <b className="is-ok">0</b>}
                  <small>atenção</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
