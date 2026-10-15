import { useRef, useState } from 'react';
import {
  Package,
  ChevronDown,
  AlertTriangle,
  Layers,
  Calendar,
  MapPin,
  Boxes,
  Info,
} from 'lucide-react';
import { formatQtd, formatMoeda } from '@/lib/format';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function formatDate(d) {
  if (!d) return '';

  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString(
      'pt-BR'
    );
  } catch {
    return d;
  }
}

function Detail({ label, value }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="break-words text-sm font-medium">
        {value}
      </p>
    </div>
  );
}

function getDepLabel(dep) {
  if (!dep) return '—';

  return dep.nome
    ? `${dep.numero || ''}${
        dep.numero ? ' - ' : ''
      }${dep.nome}`
    : dep.numero || '—';
}

export default function SetorProdutoRow({
  produto,
  gavetas,
  maquinas,
  depositos,
  lotes,
  saldos,
  expanded,
  onToggle,
  onLongPress,
  mobile = false,
}) {
  const holdTimerRef = useRef(null);
  const longPressedRef = useRef(false);
  const pointerStartRef = useRef(null);
  const [fotoOpen, setFotoOpen] = useState(false);

  const parcelas = (saldos || [])
    .filter(
      (saldo) =>
        saldo.produto_id === produto.id &&
        (saldo.quantidade || 0) > 0
    )
    .sort((a, b) =>
      (a.deposito_id || '').localeCompare(
        b.deposito_id || ''
      )
    );

  const totalReal =
    parcelas.length > 0
      ? parcelas.reduce(
          (soma, parcela) =>
            soma + (parcela.quantidade || 0),
          0
        )
      : produto.quantidade || 0;

  const baixo =
    (produto.estoque_minimo || 0) > 0 &&
    totalReal <= (produto.estoque_minimo || 0);

  const maq = maquinas.find(
    (item) => item.id === produto.maquina_id
  );

  const resolveDep = (id) =>
    depositos.find((item) => item.id === id);

  const resolveGav = (id) =>
    gavetas.find((item) => item.id === id);

  const resolveLote = (id) =>
    lotes.find((item) => item.id === id);

  const iniciarLongPress = (event) => {
    if (!mobile || !onLongPress) return;

    longPressedRef.current = false;
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    };

    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
    }

    holdTimerRef.current = setTimeout(() => {
      longPressedRef.current = true;
      onLongPress(produto);
    }, 550);
  };

  const cancelarLongPress = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    pointerStartRef.current = null;
  };

  const moverLongPress = (event) => {
    const start = pointerStartRef.current;

    if (!start) return;

    const deltaX = Math.abs(event.clientX - start.x);
    const deltaY = Math.abs(event.clientY - start.y);

    if (deltaX > 10 || deltaY > 10) {
      cancelarLongPress();
    }
  };

  const clicarProduto = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }

    onToggle?.();
  };

  if (mobile) {
    const fotoUrl = resolveMediaUrl(produto.foto_url);

    return (
      <>
        <article
        className={[
          'mobile-sector-product',
          'mobile-sector-product--v5',
          expanded ? 'is-expanded' : '',
          baixo ? 'is-low' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <button
          type="button"
          onClick={clicarProduto}
          onPointerDown={iniciarLongPress}
          onPointerMove={moverLongPress}
          onPointerUp={cancelarLongPress}
          onPointerLeave={cancelarLongPress}
          onPointerCancel={cancelarLongPress}
          onContextMenu={(event) =>
            event.preventDefault()
          }
          className="mobile-sector-product__main"
        >
          <div
            className={`mobile-sector-product__icon ${fotoUrl ? 'cursor-zoom-in' : ''}`}
            onPointerDown={(event) => {
              if (!fotoUrl) return;
              event.stopPropagation();
              cancelarLongPress();
            }}
            onPointerUp={(event) => {
              if (fotoUrl) event.stopPropagation();
            }}
            onClick={(event) => {
              if (!fotoUrl) return;
              event.stopPropagation();
              setFotoOpen(true);
            }}
          >
            {fotoUrl ? (
              <img
                src={fotoUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                  event.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <Package className={`h-5 w-5 ${fotoUrl ? 'hidden' : ''}`} />
          </div>

          <div className="mobile-sector-product__identity">
            <strong>{produto.nome}</strong>
            <span>
              Código: {produto.codigo || '—'}
            </span>
          </div>

          <div className="mobile-sector-product__qty">
            <strong>
              {formatQtd(totalReal)}
            </strong>
            <span>{produto.unidade || ''}</span>
          </div>

          <ChevronDown
            className={[
              'mobile-sector-product__chevron',
              expanded ? 'rotate-180' : '',
            ].join(' ')}
          />
        </button>

        {expanded ? (
          <div className="mobile-product-locations-v5">
            {parcelas.length === 0 ? (
              <div className="mobile-product-location-card-v5">
                <div className="mobile-product-location-line-v5">
                  <MapPin className="h-4 w-4" />
                  <div>
                    <span>Localização</span>
                    <strong>
                      Sem localização com saldo
                    </strong>
                  </div>
                </div>
              </div>
            ) : (
              parcelas.map((saldo, index) => {
                const dep = resolveDep(
                  saldo.deposito_id
                );
                const gav = resolveGav(
                  saldo.gaveta_id
                );
                const lote = saldo.lote_id
                  ? resolveLote(saldo.lote_id)
                  : null;

                return (
                  <div
                    key={saldo.id}
                    className="mobile-product-location-card-v5"
                  >
                    {parcelas.length > 1 ? (
                      <span className="mobile-product-location-index-v5">
                        Local {index + 1}
                      </span>
                    ) : null}

                    <div className="mobile-product-location-line-v5">
                      <MapPin className="h-4 w-4" />

                      <div>
                        <span>Depósito</span>
                        <strong>
                          {getDepLabel(dep)}
                        </strong>
                      </div>
                    </div>

                    <div className="mobile-product-location-line-v5">
                      <Boxes className="h-4 w-4" />

                      <div>
                        <span>Gaveta</span>
                        <strong>
                          {gav?.codigo ||
                            gav?.descricao ||
                            '—'}
                        </strong>
                      </div>
                    </div>

                    {lote ? (
                      <div className="mobile-product-lot-row-v5">
                        <div>
                          <span>Lote</span>
                          <strong>
                            {lote.codigo_lote || '—'}
                          </strong>
                        </div>

                        <div>
                          <span>Validade</span>
                          <strong>
                            {lote.data_validade
                              ? formatDate(
                                  lote.data_validade
                                )
                              : '—'}
                          </strong>
                        </div>
                      </div>
                    ) : null}

                    <div className="mobile-product-location-stock-v5">
                      <span>Quantidade neste local</span>
                      <strong>
                        {formatQtd(saldo.quantidade)}{' '}
                        {produto.unidade || ''}
                      </strong>
                    </div>
                  </div>
                );
              })
            )}

            <div className="mobile-product-hold-hint-v5">
              <Info className="h-4 w-4" />
              <span>
                Pressione e segure para ações
              </span>
            </div>
          </div>
        ) : null}
        </article>

        <Dialog open={fotoOpen} onOpenChange={setFotoOpen}>
          <DialogContent className="max-w-4xl p-3 sm:p-5">
            <DialogHeader className="sr-only">
              <DialogTitle>
                {produto.nome || 'Imagem do produto'}
              </DialogTitle>
            </DialogHeader>
            <img
              src={fotoUrl}
              alt={produto.nome || 'Produto'}
              className="max-h-[82vh] w-full rounded-lg object-contain"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-2.5 text-left transition-colors hover:bg-accent/60"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Package className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {produto.nome}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {produto.codigo}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p
            className={`text-sm font-semibold tabular-nums ${
              baixo ? 'text-destructive' : ''
            }`}
          >
            {formatQtd(totalReal)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {produto.unidade || ''}
          </p>
        </div>

        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="space-y-2.5 bg-muted/30 px-3 pb-3 pt-1">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Detail
              label="Estoque atual"
              value={`${formatQtd(totalReal)} ${
                produto.unidade || ''
              }`}
            />

            <Detail
              label="Estoque mínimo"
              value={`${formatQtd(
                produto.estoque_minimo || 0
              )} ${produto.unidade || ''}`}
            />

            <Detail
              label="Valor unitário"
              value={
                (Number(produto.custo_unitario) || 0) >
                0
                  ? formatMoeda(
                      produto.custo_unitario
                    )
                  : '—'
              }
            />

            <Detail
              label="Valor total"
              value={
                totalReal *
                  (Number(
                    produto.custo_unitario
                  ) || 0) >
                0
                  ? formatMoeda(
                      totalReal *
                        (Number(
                          produto.custo_unitario
                        ) || 0)
                    )
                  : '—'
              }
            />

            <Detail
              label="Código ref."
              value={
                produto.codigo_referencia || '—'
              }
            />

            {maq ? (
              <Detail
                label="Máquina"
                value={maq.nome}
              />
            ) : null}
          </div>

          {baixo ? (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Estoque abaixo do mínimo
            </div>
          ) : null}

          <div className="space-y-1.5 pt-1">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Boxes className="h-3 w-3" />
              Saldos por localização
            </p>

            {parcelas.length === 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                Sem saldo registrado em estoque
              </p>
            ) : (
              parcelas.map((saldo) => {
                const dep = resolveDep(
                  saldo.deposito_id
                );
                const gav = resolveGav(
                  saldo.gaveta_id
                );
                const lote = saldo.lote_id
                  ? resolveLote(saldo.lote_id)
                  : null;

                return (
                  <div
                    key={saldo.id}
                    className="space-y-1.5 rounded-md border border-border/60 bg-background/70 px-2.5 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {getDepLabel(dep)}
                        </p>

                        {gav ? (
                          <p className="font-mono text-[11px] text-muted-foreground">
                            Gaveta {gav.codigo}
                          </p>
                        ) : null}
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">
                          {formatQtd(
                            saldo.quantidade
                          )}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {saldo.unidade ||
                            produto.unidade ||
                            ''}
                        </p>
                      </div>
                    </div>

                    {lote ? (
                      <div className="flex items-center justify-between rounded bg-amber-50/60 px-1.5 py-1 text-[11px]">
                        <span className="flex min-w-0 items-center gap-1 truncate font-mono text-amber-800">
                          <Layers className="h-3 w-3 shrink-0" />
                          {lote.codigo_lote}
                        </span>

                        {lote.data_validade ? (
                          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatDate(
                              lote.data_validade
                            )}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
