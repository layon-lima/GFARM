import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useEntidades } from '@/lib/useEntidades';
import { setoresAcessiveis } from '@/lib/setoresAcesso';
import SetorIcon from '@/components/setorIcon';

export default function MobileSetores() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const { data, loading } = useEntidades({ Setor: {} });
  const setores = useMemo(
    () => setoresAcessiveis(data.Setor || [], user),
    [data.Setor, user]
  );
  const filtrados = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase('pt-BR');
    return !q ? setores : setores.filter((setor) =>
      [setor.nome, setor.descricao].join(' ').toLocaleLowerCase('pt-BR').includes(q)
    );
  }, [busca, setores]);

  return (
    <div className="mobile-page mobile-home-v6">
      <h1 className="mobile-glass-section-title">Setores</h1>
      {setores.length > 6 && (
        <div className="mobile-search-box">
          <Search className="h-4 w-4" />
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Pesquisar setor" aria-label="Pesquisar setor" />
        </div>
      )}
      {loading ? (
        <p className="mobile-loading-card">Carregando setores...</p>
      ) : filtrados.length === 0 ? (
        <p className="mobile-loading-card">Nenhum setor encontrado.</p>
      ) : (
        <div className="mobile-sector-grid">
          {filtrados.map((setor) => (
            <button type="button" key={setor.id}
              className="mobile-sector-card mobile-sector-card--v5 mobile-sector-card--v6"
              aria-label={`Abrir ${setor.nome}`} onClick={() => navigate(`/setor/${setor.id}`)}>
              <SetorIcon setor={setor} className="mobile-sector-card--v6__icon" />
              <strong className="mobile-sector-card--v6__title">{setor.nome}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
