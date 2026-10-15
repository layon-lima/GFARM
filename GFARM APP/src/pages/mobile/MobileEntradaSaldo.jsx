import { useEffect, useMemo, useState } from 'react';
import {
  Navigate,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  Search,
  Send,
  XCircle,
} from 'lucide-react';

import { api } from '@/api/apiClient';
import { entradaSaldoMobileApi } from '@/api/entradaSaldoMobileClient';
import MobileProductPhoto from '@/components/mobile/MobileProductPhoto';
import SearchSelect from '@/components/SearchSelect';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';
import { useEntidades } from '@/lib/useEntidades';
import { setoresAcessiveis } from '@/lib/setoresAcesso';
import { sortGavetas } from '@/lib/gavetas';

function numero(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;

  const normalizado = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;

  const parsed = Number(normalizado);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function carregarImagem(file) {
  const url = URL.createObjectURL(file);

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(
        new Error('Não foi possível abrir a imagem.')
      );
      img.src = url;
    });

    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function recortarQuadrado(file) {
  const image = await carregarImagem(file);

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const side = Math.min(width, height);

  if (!side) {
    throw new Error('A foto selecionada é inválida.');
  }

  const output = Math.min(side, 1280);
  const canvas = document.createElement('canvas');
  canvas.width = output;
  canvas.height = output;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error(
      'O navegador não conseguiu preparar a foto.'
    );
  }

  const sx = Math.max(0, (width - side) / 2);
  const sy = Math.max(0, (height - side) / 2);

  context.drawImage(
    image,
    sx,
    sy,
    side,
    side,
    0,
    0,
    output,
    output
  );

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9)
  );

  if (!blob) {
    throw new Error('Não foi possível recortar a foto.');
  }

  return new File(
    [blob],
    'produto-1x1-' + Date.now() + '.jpg',
    { type: 'image/jpeg' }
  );
}

function numeroDaGaveta(gaveta) {
  const grupos = String(gaveta?.codigo || '').match(/\d+/g);
  if (!grupos?.length) return null;

  const valor = Number(grupos[grupos.length - 1]);
  return Number.isFinite(valor) ? valor : null;
}

function digitosDaGaveta(gaveta) {
  const grupos = String(gaveta?.codigo || '').match(/\d+/g);
  return grupos?.[grupos.length - 1] || '';
}

function labelGaveta(gaveta) {
  return (
    (gaveta?.codigo || 'Gaveta') +
    (gaveta?.descricao ? ' — ' + gaveta.descricao : '')
  );
}

function labelDeposito(deposito) {
  const numeroDeposito = String(
    deposito?.numero || ''
  ).trim();
  const nome = String(deposito?.nome || '').trim();

  if (numeroDeposito && nome) {
    return numeroDeposito + ' — ' + nome;
  }

  return numeroDeposito || nome || 'Depósito';
}

function GavetaExactSearch({
  value,
  onChange,
  options = [],
}) {
  const ordenadas = useMemo(
    () => sortGavetas(options),
    [options]
  );

  const selecionada = ordenadas.find(
    (item) => item.id === value
  );

  const [query, setQuery] = useState(
    selecionada
      ? digitosDaGaveta(selecionada)
      : ''
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery(
        selecionada
          ? digitosDaGaveta(selecionada)
          : ''
      );
    }
  }, [selecionada, open]);

  const resultado = useMemo(() => {
    const somenteDigitos = String(query || '')
      .replace(/\D/g, '');

    if (!somenteDigitos) {
      return [];
    }

    const alvo = Number(somenteDigitos);

    if (!Number.isFinite(alvo)) {
      return [];
    }

    return ordenadas.filter(
      (gaveta) => numeroDaGaveta(gaveta) === alvo
    );
  }, [ordenadas, query]);

  function escolher(gaveta) {
    onChange(gaveta.id);
    setQuery(digitosDaGaveta(gaveta));
    setOpen(false);
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={query}
        placeholder="Digite o número da gaveta"
        className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-3 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        onFocus={(event) => {
          setOpen(true);
          event.currentTarget.select();
        }}
        onChange={(event) => {
          const digits = event.target.value
            .replace(/\D/g, '')
            .slice(0, 3);

          setQuery(digits);
          setOpen(true);

          if (value) {
            onChange('');
          }
        }}
        onBlur={() => {
          window.setTimeout(
            () => setOpen(false),
            120
          );
        }}
      />

      {open && query ? (
        <div className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-50 overflow-hidden rounded-xl border bg-background shadow-xl">
          {resultado.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              Nenhuma gaveta {Number(query) || query} neste depósito.
            </div>
          ) : (
            resultado.map((gaveta) => {
              const ativa = gaveta.id === value;

              return (
                <button
                  key={gaveta.id}
                  type="button"
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent"
                  onMouseDown={(event) =>
                    event.preventDefault()
                  }
                  onClick={() => escolher(gaveta)}
                >
                  <span className="font-semibold">
                    {labelGaveta(gaveta)}
                  </span>

                  {ativa ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function InlineNotice({ notice }) {
  if (!notice) return null;

  const tone = notice.type === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : notice.type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-slate-200 bg-slate-50 text-slate-700';

  const Icon = notice.type === 'error'
    ? AlertCircle
    : notice.type === 'success'
      ? CheckCircle2
      : Loader2;

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ' +
        tone
      }
    >
      <Icon
        className={
          'mt-0.5 h-4 w-4 shrink-0 ' +
          (notice.type === 'info' ? 'animate-spin' : '')
        }
      />

      <div className="min-w-0">
        <strong className="block text-sm leading-5">
          {notice.title}
        </strong>

        {notice.description ? (
          <span className="mt-0.5 block text-xs leading-5 opacity-80">
            {notice.description}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatusItem({ item }) {
  const status = item.status || 'PENDENTE';
  const aprovado = status === 'APROVADO';
  const rejeitado = status === 'REJEITADO';

  const Icon = aprovado
    ? CheckCircle2
    : rejeitado
      ? XCircle
      : Clock3;

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border bg-background px-3 py-2.5">
      <span
        className={
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ' +
          (aprovado
            ? 'bg-emerald-100 text-emerald-700'
            : rejeitado
              ? 'bg-red-100 text-red-700'
              : 'bg-amber-100 text-amber-700')
        }
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <strong className="block truncate text-sm font-semibold">
          {item.nome_produto}
        </strong>

        <span className="block truncate text-[11px] text-muted-foreground">
          {item.quantidade} {item.unidade || 'un'} · {
            status === 'PENDENTE'
              ? 'Aguardando revisão'
              : status === 'APROVADO'
                ? 'Aprovado'
                : 'Rejeitado'
          }
        </span>
      </div>
    </div>
  );
}

// A seleção de setor é uma etapa própria para manter o usuário no contexto escolhido.
function SectorSelection({
  setores,
  depositos,
  loading,
  onBack,
  onSelect,
}) {
  return (
    <div className="mobile-page pb-6">
      <header className="mb-4 flex items-center gap-3">
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-background"
          onClick={onBack}
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold leading-tight">
            Entrada Manual de Saldo
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Selecione o setor onde será feita a entrada.
          </p>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : setores.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-5 text-center">
          <p className="text-sm font-semibold">
            Nenhum setor disponível
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Seu usuário não possui setores liberados para esta operação.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {setores.map((setor) => {
            const totalDepositos = depositos.filter(
              (deposito) =>
                deposito.setor_id === setor.id
            ).length;

            return (
              <button
                key={setor.id}
                type="button"
                onClick={() => onSelect(setor.id)}
                className="flex min-h-[68px] w-full items-center gap-3 rounded-2xl border bg-card px-3.5 py-3 text-left active:bg-muted/35"
              >
                <div className="min-w-0 flex-1">
                  <strong className="block break-words text-sm font-bold leading-tight">
                    {setor.nome}
                  </strong>

                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {totalDepositos === 1
                      ? '1 depósito · seleção automática'
                      : totalDepositos > 1
                        ? totalDepositos + ' depósitos'
                        : 'Sem depósito cadastrado'}
                  </span>
                </div>

                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MobileEntradaSaldo() {
  const navigate = useNavigate();
  const { setorId } = useParams();
  const { user } = useAuth();

  const permitido =
    user?.role === 'admin'
    || user?.pode_entrada_manual_saldo_mobile === true;

  const { data, loading } = useEntidades({
    Setor: {},
    Deposito: {},
    Gaveta: {},
  });

  const setores = data.Setor || [];
  const depositos = data.Deposito || [];
  const gavetas = data.Gaveta || [];

  const setoresPermitidos = useMemo(
    () =>
      setoresAcessiveis(setores, user)
        .slice()
        .sort((a, b) =>
          String(a.nome || '').localeCompare(
            String(b.nome || ''),
            'pt-BR'
          )
        ),
    [setores, user]
  );

  const setorSelecionado = useMemo(
    () =>
      setoresPermitidos.find(
        (item) => String(item.id) === String(setorId || '')
      ) || null,
    [setoresPermitidos, setorId]
  );

  const depositosDoSetor = useMemo(
    () =>
      setorSelecionado
        ? depositos
            .filter(
              (item) =>
                item.setor_id === setorSelecionado.id
            )
            .slice()
            .sort((a, b) =>
              labelDeposito(a).localeCompare(
                labelDeposito(b),
                'pt-BR'
              )
            )
        : [],
    [depositos, setorSelecionado]
  );

  const depositoUnico =
    depositosDoSetor.length === 1
      ? depositosDoSetor[0]
      : null;

  const [form, setForm] = useState({
    nome_produto: '',
    quantidade: '',
    deposito_id: '',
    gaveta_id: '',
    foto_url: '',
  });

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [recentes, setRecentes] = useState([]);
  const [loadingRecentes, setLoadingRecentes] = useState(false);

  useEffect(() => {
    if (!setorSelecionado) {
      return;
    }

    setNotice(null);

    setForm((prev) => {
      const depositoAtualValido =
        !!prev.deposito_id
        && depositosDoSetor.some(
          (item) => item.id === prev.deposito_id
        );

      const proximoDeposito = depositoUnico
        ? depositoUnico.id
        : depositoAtualValido
          ? prev.deposito_id
          : '';

      if (
        prev.deposito_id === proximoDeposito
        && !prev.gaveta_id
      ) {
        return prev;
      }

      return {
        ...prev,
        deposito_id: proximoDeposito,
        gaveta_id: '',
      };
    });
  }, [
    setorSelecionado,
    depositoUnico,
    depositosDoSetor,
  ]);

  const gavetasDoDeposito = useMemo(
    () =>
      sortGavetas(
        gavetas.filter(
          (item) =>
            item.deposito_id === form.deposito_id
        )
      ),
    [gavetas, form.deposito_id]
  );

  const gavetaObrigatoria =
    !!form.deposito_id
    && gavetasDoDeposito.length > 0;

  const recentesDoSetor = useMemo(
    () =>
      setorSelecionado
        ? recentes
            .filter(
              (item) =>
                item.setor_id === setorSelecionado.id
            )
            .slice(0, 3)
        : [],
    [recentes, setorSelecionado]
  );

  async function carregarRecentes() {
    if (!permitido) return;

    setLoadingRecentes(true);

    try {
      const itens = await entradaSaldoMobileApi.minhas();
      setRecentes(itens || []);
    } catch {
      setRecentes([]);
    } finally {
      setLoadingRecentes(false);
    }
  }

  useEffect(() => {
    carregarRecentes();
  }, [permitido]);

  function setCampo(campo, valor) {
    setNotice(null);

    setForm((prev) => ({
      ...prev,
      [campo]: valor,
      ...(campo === 'deposito_id'
        ? { gaveta_id: '' }
        : {}),
    }));
  }

  function erro(title, description = '') {
    setNotice({
      type: 'error',
      title,
      description,
    });
  }

  async function enviarFoto(file) {
    if (!file) return;

    setUploading(true);
    setNotice({
      type: 'info',
      title: 'Preparando foto...',
      description:
        'A imagem será ajustada automaticamente para 1:1.',
    });

    try {
      const quadrada = await recortarQuadrado(file);
      const result = await api.integrations.Core.UploadFile({
        file: quadrada,
      });

      setForm((prev) => ({
        ...prev,
        foto_url: result.file_url,
      }));

      setNotice(null);
    } catch (error) {
      erro(
        'Não foi possível usar esta foto',
        error.message
      );
    } finally {
      setUploading(false);
    }
  }

  async function enviar(event) {
    event.preventDefault();

    if (!setorSelecionado) {
      erro('Selecione um setor.');
      return;
    }

    const quantidade = numero(form.quantidade);

    if (!form.nome_produto.trim()) {
      erro('Informe o nome do produto.');
      return;
    }

    if (quantidade <= 0) {
      erro('Informe uma quantidade maior que zero.');
      return;
    }

    if (!form.deposito_id) {
      erro(
        depositosDoSetor.length === 0
          ? 'Este setor não possui depósito cadastrado.'
          : 'Selecione o depósito.'
      );
      return;
    }

    if (gavetaObrigatoria && !form.gaveta_id) {
      erro(
        'Selecione a gaveta.',
        'Este depósito possui gavetas vinculadas.'
      );
      return;
    }

    setSaving(true);
    setNotice({
      type: 'info',
      title: 'Enviando para revisão...',
    });

    try {
      await entradaSaldoMobileApi.criar({
        nome_produto: form.nome_produto.trim(),
        quantidade,
        setor_id: setorSelecionado.id,
        deposito_id: form.deposito_id,
        gaveta_id: form.gaveta_id || null,
        foto_url: form.foto_url || null,
      });

      setForm((prev) => ({
        nome_produto: '',
        quantidade: '',
        deposito_id: prev.deposito_id,
        gaveta_id: '',
        foto_url: '',
      }));

      setNotice({
        type: 'success',
        title: 'Enviado para revisão.',
        description:
          'Você continua neste setor para lançar o próximo produto.',
      });

      await carregarRecentes();
    } catch (error) {
      erro(
        'Não foi possível enviar.',
        error.message
      );
    } finally {
      setSaving(false);
    }
  }

  if (!permitido) {
    return <Navigate to="/" replace />;
  }

  if (!setorId || (!loading && !setorSelecionado)) {
    return (
      <SectorSelection
        setores={setoresPermitidos}
        depositos={depositos}
        loading={loading}
        onBack={() => navigate('/')}
        onSelect={(id) =>
          navigate(
            '/entrada-manual-saldo/' +
            encodeURIComponent(id)
          )
        }
      />
    );
  }

  if (loading || !setorSelecionado) {
    return (
      <div className="mobile-page flex min-h-[45vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mobile-page pb-6">
      <header className="mb-3 flex items-center gap-3">
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-background"
          onClick={() => navigate('/entrada-manual-saldo')}
          aria-label="Trocar setor"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
            Entrada Manual
          </span>

          <h1 className="truncate text-lg font-bold leading-tight">
            {setorSelecionado.nome}
          </h1>
        </div>

        <button
          type="button"
          className="shrink-0 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-primary"
          onClick={() => navigate('/entrada-manual-saldo')}
        >
          Trocar setor
        </button>
      </header>

      <form onSubmit={enviar} className="space-y-3">
        <section className="space-y-3 rounded-2xl border bg-card p-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="entrada-mobile-produto">
              Produto
            </Label>

            <Input
              id="entrada-mobile-produto"
              value={form.nome_produto}
              onChange={(event) =>
                setCampo(
                  'nome_produto',
                  event.target.value
                )
              }
              placeholder="Nome do produto"
              autoComplete="off"
              className="h-12 rounded-xl text-base"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="entrada-mobile-qtd">
              Quantidade
            </Label>

            <Input
              id="entrada-mobile-qtd"
              inputMode="decimal"
              value={form.quantidade}
              onChange={(event) =>
                setCampo(
                  'quantidade',
                  event.target.value
                )
              }
              placeholder="0,00"
              className="h-12 rounded-xl text-base"
              required
            />
          </div>

          {depositosDoSetor.length > 1 ? (
            <div className="space-y-1.5">
              <Label>Depósito</Label>

              <SearchSelect
                value={form.deposito_id || 'all'}
                onChange={(value) =>
                  setCampo(
                    'deposito_id',
                    value === 'all'
                      ? ''
                      : value
                  )
                }
                allLabel="Selecione o depósito"
                placeholder="Selecione o depósito"
                options={depositosDoSetor.map(
                  (item) => ({
                    value: item.id,
                    label: labelDeposito(item),
                  })
                )}
              />
            </div>
          ) : null}

          {depositosDoSetor.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              Este setor ainda não possui depósito cadastrado.
            </div>
          ) : null}

          {form.deposito_id
            && gavetasDoDeposito.length > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>Gaveta</Label>

                  <span className="text-[10px] font-semibold text-amber-700">
                    OBRIGATÓRIA
                  </span>
                </div>

                <GavetaExactSearch
                  value={form.gaveta_id}
                  onChange={(value) =>
                    setCampo(
                      'gaveta_id',
                      value
                    )
                  }
                  options={gavetasDoDeposito}
                />

                <p className="text-[11px] leading-4 text-muted-foreground">
                  Digite o número exato. Ex.: 1 ou 01 → GAVETA 01; 10 → somente GAVETA 10.
                </p>
              </div>
            ) : null}
        </section>

        <section className="rounded-2xl border bg-card p-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <div>
              <Label>Foto</Label>

              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Opcional · corte automático 1:1
              </p>
            </div>

            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/20">
              {form.foto_url ? (
                <Image
                  src={form.foto_url}
                  alt="Foto do produto"
                  className="h-full w-full object-cover"
                />
              ) : (
                <Camera className="h-5 w-5 text-muted-foreground/60" />
              )}
            </div>
          </div>

          <MobileProductPhoto
            uploading={uploading}
            onFile={enviarFoto}
          />
        </section>

        <InlineNotice notice={notice} />

        <Button
          type="submit"
          className="h-12 w-full rounded-xl text-base font-semibold"
          disabled={
            saving
            || uploading
            || loading
            || depositosDoSetor.length === 0
          }
        >
          {saving ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <Send className="mr-2 h-5 w-5" />
          )}

          {saving
            ? 'Enviando...'
            : 'Enviar para revisão'}
        </Button>
      </form>

      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Últimos envios deste setor
          </span>

          {loadingRecentes ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        {!loadingRecentes
          && recentesDoSetor.length === 0 ? (
            <p className="rounded-xl border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
              Nenhum envio neste setor ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {recentesDoSetor.map((item) => (
                <StatusItem
                  key={item.id}
                  item={item}
                />
              ))}
            </div>
          )}
      </section>
    </div>
  );
}
