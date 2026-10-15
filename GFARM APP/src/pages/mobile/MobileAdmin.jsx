import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Boxes, Loader2, MapPinned, Package, Send, Warehouse } from 'lucide-react';
import { Navigate } from 'react-router-dom';

import { api } from '@/api/apiClient';
import { cadastrosMobileApi } from '@/api/cadastrosMobileClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SearchSelect from '@/components/SearchSelect';
import { Image } from '@/components/ui/image';
import MobileProductPhoto from '@/components/mobile/MobileProductPhoto';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { useEntidades } from '@/lib/useEntidades';
import { UNIDADES } from '@/lib/units';

const CONFIG = {
  PRODUTO: { label: 'Produtos', singular: 'Produto', icon: Package, tone: 'bg-blue-50 text-blue-700' },
  DEPOSITO: { label: 'Depósitos', singular: 'Depósito', icon: Warehouse, tone: 'bg-amber-50 text-amber-700' },
  SETOR: { label: 'Setores', singular: 'Setor', icon: Boxes, tone: 'bg-emerald-50 text-emerald-700' },
  GAVETA: { label: 'Gavetas', singular: 'Gaveta', icon: MapPinned, tone: 'bg-violet-50 text-violet-700' },
};

const EMPTY = {
  PRODUTO: { nome: '', codigo_referencia: '', setor_id: '', deposito_id: '', gaveta_id: '', maquina_id: '', unidade: 'un', unidade_alt: '', fator_conversao: 0, estoque_minimo: 0, custo_unitario: 0, venda: false, foto_url: '' },
  DEPOSITO: { numero: '', nome: '', setor_id: '', descricao: '' },
  SETOR: { nome: '', descricao: '', cor: '#16a34a', icon: '', controla_validade: false, tem_aba_mobile: false, permite_inventario: false },
  GAVETA: { codigo: '', descricao: '', deposito_id: '' },
};

const storageUser = (user) => String(user?.id || user?.username || 'admin');
const draftKey = (user, tipo) => `nh_admin_mobile_draft_${storageUser(user)}_${tipo.toLowerCase()}`;
const activeTypeKey = (user) => `nh_admin_mobile_active_type_${storageUser(user)}`;

export default function MobileAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tipo, setTipo] = useState(null);
  const [form, setForm] = useState(null);
  const [pendentes, setPendentes] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { data } = useEntidades({ Setor: {}, Deposito: {}, Gaveta: {}, Maquina: {} });
  const podeUsarModoAdmin = hasPermission(
    user,
    'admin.cadastros_mobile.solicitar'
  );

  useEffect(() => {
    if (!podeUsarModoAdmin) return;

    cadastrosMobileApi
      .contador()
      .then((result) => setPendentes(result.pendentes))
      .catch(() => {});

    const ativo = localStorage.getItem(activeTypeKey(user));
    if (ativo && CONFIG[ativo]) setTipo(ativo);
  }, [podeUsarModoAdmin, user]);

  useEffect(() => {
    if (!tipo || !podeUsarModoAdmin) return;

    const salvo = localStorage.getItem(draftKey(user, tipo));
    try {
      setForm(salvo ? { ...EMPTY[tipo], ...JSON.parse(salvo) } : { ...EMPTY[tipo] });
    } catch {
      setForm({ ...EMPTY[tipo] });
    }
  }, [podeUsarModoAdmin, tipo, user]);

  useEffect(() => {
    if (tipo && form && podeUsarModoAdmin) {
      localStorage.setItem(draftKey(user, tipo), JSON.stringify(form));
    }
  }, [form, podeUsarModoAdmin, tipo, user]);

  const set = (campo, valor) => setForm((atual) => ({ ...atual, [campo]: valor }));
  const setores = data.Setor || [];
  const depositos = data.Deposito || [];
  const gavetas = useMemo(
    () => (data.Gaveta || []).filter((g) => !form?.deposito_id || g.deposito_id === form.deposito_id),
    [data.Gaveta, form?.deposito_id]
  );

  if (!podeUsarModoAdmin) return <Navigate to="/" replace />;

  function abrirTipo(novoTipo) {
    localStorage.setItem(activeTypeKey(user), novoTipo);
    setTipo(novoTipo);
  }

  function persistirRascunho() {
    if (!tipo || !form) return;
    localStorage.setItem(activeTypeKey(user), tipo);
    localStorage.setItem(draftKey(user, tipo), JSON.stringify(form));
  }

  function voltar() {
    localStorage.removeItem(activeTypeKey(user));
    setTipo(null);
  }

  async function upload(file) {
    if (!file || !tipo || !form) return;

    persistirRascunho();
    const fotoAnterior = form.foto_url;
    setUploading(true);

    try {
      const result = await api.integrations.Core.UploadFile({ file });
      const proximoForm = { ...form, foto_url: result.file_url };

      setForm(proximoForm);
      localStorage.setItem(draftKey(user, tipo), JSON.stringify(proximoForm));

      if (fotoAnterior && fotoAnterior !== result.file_url) {
        cadastrosMobileApi.removerImagemTemporaria(fotoAnterior).catch(() => {});
      }

      toast({
        title: 'Foto enviada',
        description: 'O formulário e a foto foram preservados.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao enviar foto',
        description: error.message,
      });
    } finally {
      setUploading(false);
    }
  }

  async function enviar(event) {
    event.preventDefault();
    setSaving(true);

    try {
      await cadastrosMobileApi.criar(tipo, form, form.foto_url || null);
      localStorage.removeItem(draftKey(user, tipo));
      localStorage.removeItem(activeTypeKey(user));
      setForm({ ...EMPTY[tipo] });
      setPendentes((n) => n + 1);

      toast({
        title: 'Solicitação enviada',
        description: 'O cadastro aguarda aprovação no computador.',
      });

      setTipo(null);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível enviar',
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function cancelar() {
    if (!window.confirm('Descartar o rascunho deste cadastro?')) return;

    const fotoTemporaria = form?.foto_url;

    localStorage.removeItem(draftKey(user, tipo));
    localStorage.removeItem(activeTypeKey(user));
    setForm(null);
    setTipo(null);

    if (fotoTemporaria) {
      cadastrosMobileApi.removerImagemTemporaria(fotoTemporaria).catch(() => {});
    }
  }

  if (!tipo) {
    return (
      <div className="mobile-page space-y-4 px-4 py-5">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            Função administrativa
          </p>
          <h1 className="text-2xl font-bold">Modo Admin</h1>
          <p className="text-sm text-muted-foreground">
            Envie cadastros para revisão no computador.
          </p>
        </header>

        <Card className="flex items-center justify-between rounded-2xl p-4">
          <span className="font-semibold">Pendentes</span>
          <strong className="text-2xl text-primary">{pendentes}</strong>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          {Object.entries(CONFIG).map(([key, config]) => {
            const Icon = config.icon;
            return (
              <button
                type="button"
                key={key}
                onClick={() => abrirTipo(key)}
                className="flex min-h-36 flex-col items-start justify-between rounded-2xl border bg-card p-4 text-left shadow-sm"
              >
                <span className={`rounded-xl p-3 ${config.tone}`}>
                  <Icon className="h-6 w-6" />
                </span>
                <strong>{config.label}</strong>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-page px-4 py-4">
      <div className="mb-4 flex items-center gap-3">
        <Button type="button" variant="outline" size="icon" onClick={voltar}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div>
          <p className="text-xs font-bold uppercase text-primary">Solicitação mobile</p>
          <h1 className="text-xl font-semibold">Novo {CONFIG[tipo].singular}</h1>
        </div>
      </div>

      {form ? (
        <form onSubmit={enviar} className="space-y-4">
          <Card className="space-y-4 rounded-2xl p-4">
            {tipo === 'PRODUTO' ? (
              <>
                <Field label="Nome *">
                  <Input value={form.nome} onChange={(e) => set('nome', e.target.value)} required />
                </Field>

                <Field label="Código de referência">
                  <Input value={form.codigo_referencia} onChange={(e) => set('codigo_referencia', e.target.value)} />
                </Field>

                <Field label="Setor *">
                  <Select
                    value={form.setor_id}
                    onChange={(v) => set('setor_id', v)}
                    options={setores.map((x) => ({ value: x.id, label: x.nome }))}
                  />
                </Field>

                <Field label="Depósito">
                  <Select
                    value={form.deposito_id}
                    onChange={(v) => set('deposito_id', v)}
                    options={depositos.map((x) => ({
                      value: x.id,
                      label: `${x.numero || ''} ${x.nome || ''}`.trim(),
                    }))}
                  />
                </Field>

                <Field label="Gaveta">
                  <Select
                    value={form.gaveta_id}
                    onChange={(v) => set('gaveta_id', v)}
                    options={gavetas.map((x) => ({ value: x.id, label: x.codigo }))}
                  />
                </Field>

                <Field label="Máquina / etiqueta">
                  <Select
                    value={form.maquina_id}
                    onChange={(v) => set('maquina_id', v)}
                    options={(data.Maquina || []).map((x) => ({
                      value: x.id,
                      label: `${x.codigo || ''} ${x.nome || ''}`.trim(),
                    }))}
                  />
                </Field>

                <Field label="Unidade">
                  <Select
                    value={form.unidade}
                    onChange={(v) => set('unidade', v)}
                    options={UNIDADES.flatMap((g) =>
                      g.itens.map((x) => ({ value: x.value, label: x.label }))
                    )}
                  />
                </Field>

                <Field label="Unidade alternativa">
                  <Select
                    value={form.unidade_alt}
                    onChange={(v) => set('unidade_alt', v)}
                    options={UNIDADES.flatMap((g) =>
                      g.itens.map((x) => ({ value: x.value, label: x.label }))
                    )}
                  />
                </Field>

                <Field label="Fator de conversão">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    value={form.fator_conversao}
                    onChange={(e) => set('fator_conversao', e.target.value)}
                  />
                </Field>

                <Field label="Estoque mínimo">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={form.estoque_minimo}
                    onChange={(e) => set('estoque_minimo', e.target.value)}
                  />
                </Field>

                <Field label="Custo unitário">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={form.custo_unitario}
                    onChange={(e) => set('custo_unitario', e.target.value)}
                  />
                </Field>

                <label className="flex items-center gap-3">
                  <Checkbox
                    checked={form.venda}
                    onCheckedChange={(v) => set('venda', !!v)}
                  />
                  Produto de venda
                </label>

                <div className="space-y-3 border-t pt-4">
                  <Label>Foto do produto</Label>

                  {form.foto_url ? (
                    <Image
                      src={form.foto_url}
                      alt="Prévia do produto"
                      className="h-44 w-full rounded-xl border object-cover"
                    />
                  ) : null}

                  <MobileProductPhoto
                    uploading={uploading}
                    onBeforeOpen={persistirRascunho}
                    onFile={upload}
                  />
                </div>
              </>
            ) : null}

            {tipo === 'DEPOSITO' ? (
              <>
                <Field label="Número *">
                  <Input value={form.numero} onChange={(e) => set('numero', e.target.value)} required />
                </Field>
                <Field label="Nome">
                  <Input value={form.nome} onChange={(e) => set('nome', e.target.value)} />
                </Field>
                <Field label="Setor">
                  <Select
                    value={form.setor_id}
                    onChange={(v) => set('setor_id', v)}
                    options={setores.map((x) => ({ value: x.id, label: x.nome }))}
                  />
                </Field>
                <Field label="Descrição">
                  <Input value={form.descricao} onChange={(e) => set('descricao', e.target.value)} />
                </Field>
              </>
            ) : null}

            {tipo === 'SETOR' ? (
              <>
                <Field label="Nome *">
                  <Input value={form.nome} onChange={(e) => set('nome', e.target.value)} required />
                </Field>
                <Field label="Descrição">
                  <Input value={form.descricao} onChange={(e) => set('descricao', e.target.value)} />
                </Field>
                <Field label="Cor">
                  <Input type="color" value={form.cor} onChange={(e) => set('cor', e.target.value)} />
                </Field>
                <Toggle label="Controla validade" checked={form.controla_validade} onChange={(v) => set('controla_validade', v)} />
                <Toggle label="Aparece no mobile" checked={form.tem_aba_mobile} onChange={(v) => set('tem_aba_mobile', v)} />
                <Toggle label="Permite inventário" checked={form.permite_inventario} onChange={(v) => set('permite_inventario', v)} />
              </>
            ) : null}

            {tipo === 'GAVETA' ? (
              <>
                <Field label="Código *">
                  <Input value={form.codigo} onChange={(e) => set('codigo', e.target.value)} required />
                </Field>
                <Field label="Depósito">
                  <Select
                    value={form.deposito_id}
                    onChange={(v) => set('deposito_id', v)}
                    options={depositos.map((x) => ({
                      value: x.id,
                      label: `${x.numero || ''} ${x.nome || ''}`.trim(),
                    }))}
                  />
                </Field>
                <Field label="Descrição">
                  <Input value={form.descricao} onChange={(e) => set('descricao', e.target.value)} />
                </Field>
              </>
            ) : null}
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={cancelar}>
              Cancelar
            </Button>

            <Button type="submit" disabled={saving || uploading}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Enviar
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <SearchSelect
      value={value || 'all'}
      onChange={(v) => onChange(v === 'all' ? '' : v)}
      allLabel="— Nenhum —"
      placeholder="Selecione…"
      options={options}
    />
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex min-h-11 items-center justify-between rounded-xl border p-3">
      <span>{label}</span>
      <Checkbox checked={!!checked} onCheckedChange={(v) => onChange(!!v)} />
    </label>
  );
}
