import { useState, useEffect, useMemo } from 'react';
import { Fuel, Droplet, Gauge, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { formatQtd } from '@/lib/format';
import { setorControlaValidade } from '@/lib/lotes';

// Calcula o saldo disponível de um combustível (considera lotes quando o setor controla validade).
function saldoProduto(produto, lotes, setores) {
  if (!produto) return 0;
  if (setorControlaValidade(produto.setor_id, setores)) {
    return (lotes || [])
      .filter((l) => l.produto_id === produto.id)
      .reduce((s, l) => s + (l.quantidade || 0), 0);
  }
  return produto.quantidade || 0;
}

// Cor do líquido conforme o nível (relativo ao estoque mínimo).
function estadoLiquido(saldo, minimo) {
  if (minimo > 0 && saldo <= minimo) {
    return {
      nivel: 'critico',
      liquido: 'rgba(220, 38, 38, 0.85)',
      liquidoTopo: 'rgba(248, 113, 113, 0.65)',
      onda: 'rgba(254, 202, 202, 0.55)',
    };
  }
  if (minimo > 0 && saldo <= minimo * 1.2) {
    return {
      nivel: 'baixo',
      liquido: 'rgba(245, 158, 11, 0.85)',
      liquidoTopo: 'rgba(252, 211, 77, 0.6)',
      onda: 'rgba(254, 240, 138, 0.55)',
    };
  }
  return {
    nivel: 'ok',
    liquido: 'rgba(255, 255, 255, 0.32)',
    liquidoTopo: 'rgba(255, 255, 255, 0.22)',
    onda: 'rgba(255, 255, 255, 0.42)',
  };
}

export default function CombustivelResumo({ combustiveis, lotes, setores, loading }) {
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (!selectedId && combustiveis.length > 0) {
      setSelectedId(combustiveis[0].id);
    }
  }, [combustiveis, selectedId]);

  const itens = useMemo(
    () =>
      (combustiveis || []).map((p) => ({
        id: p.id,
        nome: p.nome,
        unidade: p.unidade || 'L',
        saldo: saldoProduto(p, lotes, setores),
        minimo: p.estoque_minimo || 0,
      })),
    [combustiveis, lotes, setores]
  );

  if (loading) {
    return <Card className="p-4 animate-pulse h-40 bg-muted" />;
  }

  if (itens.length === 0) return null;

  const selecionado = itens.find((i) => i.id === selectedId) || itens[0];
  const { saldo, minimo, unidade, nome } = selecionado;

  // Referência de "tanque cheio": 4× o estoque mínimo (mínimo = ¼ do tanque, como num medidor real).
  const refMax = minimo > 0 ? minimo * 4 : saldo > 0 ? saldo : 1;
  const fillPct = Math.max(4, Math.min(100, (saldo / refMax) * 100));
  const estado = estadoLiquido(saldo, minimo);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl shadow-lg select-none">
        {/* Fundo do tanque (parte vazia) — gradiente laranja */}
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500 to-orange-700" />

        {/* Líquido: preenche de baixo para cima conforme o nível */}
        <div
          className="absolute left-0 right-0 bottom-0 transition-[height] duration-700 ease-out"
          style={{ height: `${fillPct}%`, background: `linear-gradient(180deg, ${estado.liquidoTopo}, ${estado.liquido})` }}
        >
          {/* Onda na superfície do líquido (elipse rotacionada) */}
          <div
            className="liquid-surface absolute left-1/2"
            style={{
              bottom: '100%',
              width: '320%',
              paddingBottom: '320%',
              borderRadius: '42%',
              background: estado.onda,
              transform: 'translate(-50%, 50%)',
            }}
          />
          <div
            className="liquid-surface-slow absolute left-1/2"
            style={{
              bottom: '100%',
              width: '260%',
              paddingBottom: '260%',
              borderRadius: '45%',
              background: estado.onda,
              opacity: 0.6,
              transform: 'translate(-50%, 50%)',
            }}
          />
        </div>

        {/* Conteúdo textual sobre o tanque */}
        <div className="relative p-5 h-44 flex flex-col justify-between text-white">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide drop-shadow">
              <Gauge className="w-4 h-4" />
              Total disponível
            </span>
            <Fuel className="w-5 h-5 opacity-90 drop-shadow" />
          </div>

          <div className="text-center">
            <div className="flex items-end justify-center gap-1.5">
              <span className="text-4xl sm:text-5xl font-bold tabular-nums drop-shadow-lg leading-none">
                {formatQtd(saldo)}
              </span>
              <span className="text-lg font-medium opacity-90 mb-1">{unidade}</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium drop-shadow">
              <Droplet className="w-3.5 h-3.5" />
              {nome}
            </span>
            <span className="opacity-90 drop-shadow">
              {minimo > 0 ? `mínimo: ${formatQtd(minimo)} ${unidade}` : 'em estoque'}
            </span>
          </div>
        </div>
      </div>

      {/* Alerta de estoque baixo */}
      {minimo > 0 && saldo <= minimo && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 px-1">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {nome} abaixo do estoque mínimo.
        </div>
      )}

      {/* Seletor de combustível (quando há mais de um) */}
      {itens.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
          {itens.map((i) => {
            const ativo = i.id === selecionado.id;
            const crit = i.minimo > 0 && i.saldo <= i.minimo;
            return (
              <button
                key={i.id}
                onClick={() => setSelectedId(i.id)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  ativo
                    ? 'border-orange-500 bg-orange-50 text-orange-700'
                    : 'border-border bg-card hover:bg-accent text-foreground'
                }`}
              >
                <Droplet className={`w-3.5 h-3.5 ${crit ? 'text-red-500' : 'text-amber-500'}`} />
                <span className="truncate max-w-[140px]">{i.nome}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatQtd(i.saldo)} {i.unidade}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}