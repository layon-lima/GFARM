import { CheckCircle2, Clock3, FileText, History, Pencil, ShieldCheck, UserRound, XCircle } from 'lucide-react';

const moeda = (valor) => Number(valor || 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL',
});
const qtd = (valor) => Number(valor || 0).toLocaleString('pt-BR', {
  maximumFractionDigits: 3,
});
const data = (valor) => {
  if (!valor) return '—';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', {
    dateStyle: 'short', timeStyle: 'short',
  });
};

const rotulos = {
  solicitar: 'Solicitação criada',
  editar: 'Solicitação alterada',
  aprovar: 'Baixa aprovada',
  reconciliar: 'Baixa conciliada',
  recusar: 'Solicitação recusada',
};
const icones = {
  solicitar: UserRound,
  editar: Pencil,
  aprovar: CheckCircle2,
  reconciliar: ShieldCheck,
  recusar: XCircle,
};

export default function HistoricoInforme({ historico, carregando, erro }) {
  if (carregando || !historico) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-[#f5faf7] px-3 py-3 text-xs text-slate-500">
        <Clock3 className="h-4 w-4" /> Carregando histórico...
      </div>
    );
  }
  if (erro) {
    return <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{erro}</p>;
  }

  const { solicitacao, eventos = [], financeiro } = historico;
  return (
    <div className="space-y-3 border-t border-[#e3ede5] pt-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-emerald-700" />
        <h3 className="text-sm font-bold">Histórico desta solicitação</h3>
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <div className="rounded-xl bg-[#f4f9f5] px-3 py-2">
          <span className="block text-slate-500">Solicitado por</span>
          <strong className="block pt-1">{solicitacao.solicitante_nome || 'Não identificado'}</strong>
          <small className="text-slate-500">{data(solicitacao.created_date)}</small>
        </div>
        <div className="rounded-xl bg-[#f4f9f5] px-3 py-2">
          <span className="block text-slate-500">Situação da análise</span>
          <strong className="block pt-1">
            {solicitacao.status === 'APROVADO' ? 'Aprovada' :
              solicitacao.status === 'RECUSADO' ? 'Recusada' :
                solicitacao.status === 'PROCESSANDO' ? 'Em processamento' : 'Pendente'}
          </strong>
          {solicitacao.analisado_por_nome && (
            <small className="text-slate-500">
              {solicitacao.analisado_por_nome} · {data(solicitacao.analisado_em)}
            </small>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-bold text-[#244638]">Local e identificação dos produtos</h4>
        {(solicitacao.itens || []).map((linha, i) => (
          <div className="rounded-xl border border-[#e5efe8] bg-[#fafdfa] px-3 py-2" key={i}>
            <div className="flex items-start justify-between gap-2 text-xs">
              <span className="min-w-0">
                <strong className="block">{linha.produto_nome || linha.produto_id}</strong>
                {linha.produto_codigo && <small className="text-slate-500">{linha.produto_codigo}</small>}
              </span>
              <strong className="shrink-0 tabular-nums">{qtd(linha.quantidade)} {linha.unidade || ''}</strong>
            </div>
            {(linha.deposito_id || linha.gaveta_id) && (
              <p className="mt-1 text-[11px] text-slate-500">
                Retirada: {linha.deposito_nome || linha.deposito_id || 'Depósito não especificado'}
                {linha.gaveta_id ? ` · ${linha.gaveta_nome || linha.gaveta_id}` : ''}
              </p>
            )}
          </div>
        ))}
      </div>

      {financeiro && (
        <section className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
            <FileText className="h-4 w-4" /> Documento {financeiro.documento_numero}
          </div>
          <p className="mt-1 text-[11px] text-emerald-700">
            Baixa contabilizada em {data(financeiro.contabilizado_em)}
          </p>
          <strong className="mt-2 block text-base font-bold text-emerald-950">
            Custo oficial: {moeda(financeiro.custo_total)}
          </strong>
          <div className="mt-2 space-y-1 border-t border-emerald-100 pt-2">
            {(financeiro.itens || []).map((linha, i) => (
              <div className="flex items-start justify-between gap-2 text-[11px]" key={i}>
                <span className="min-w-0 text-emerald-900">
                  {linha.produto_nome} · {qtd(linha.quantidade)} {linha.unidade}
                  <span className="block text-emerald-700">{moeda(linha.custo_unitario)} / {linha.unidade}</span>
                </span>
                <strong className="shrink-0 tabular-nums">{moeda(linha.valor_total)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {eventos.length === 0 ? (
        <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
          Não existem eventos de auditoria disponíveis para esta solicitação antiga.
          Isso não significa que não houve alterações.
        </div>
      ) : (
        <div className="space-y-2">
          {eventos.map((evento) => {
            const Icon = icones[evento.acao] || History;
            return (
              <section key={evento.id} className="rounded-xl border border-[#e1ebe3] bg-white px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#edf7f0] text-emerald-800">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <strong className="block text-xs">{rotulos[evento.acao] || evento.acao}</strong>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {evento.usuario_nome} · {data(evento.data)}
                    </p>
                  </div>
                </div>
                {(evento.alteracoes || []).length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-[#edf2ee] pt-2">
                    {evento.alteracoes.map((mudanca, i) => (
                      <div key={i} className="text-xs">
                        <strong className="block text-[#254b38]">{mudanca.campo}</strong>
                        <span className="block break-words text-slate-500">
                          {mudanca.antes} → {mudanca.depois}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {evento.acao === 'editar' && !(evento.alteracoes || []).length && (
                  <p className="mt-2 text-[11px] text-slate-500">Edição registrada sem mudança nos campos exibidos.</p>
                )}
                {evento.acao === 'solicitar' && evento.estado_depois?.itens?.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-semibold text-emerald-700">
                      Produtos informados originalmente
                    </summary>
                    <div className="mt-1 space-y-1 rounded-lg bg-[#f5faf6] px-2 py-2">
                      {evento.estado_depois.itens.map((linha, i) => (
                        <div key={i} className="flex justify-between gap-2">
                          <span>{linha.produto_nome || linha.produto_id}</span>
                          <strong className="shrink-0">{qtd(linha.quantidade)} {linha.unidade || ''}</strong>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
