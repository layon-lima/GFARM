import { useState, useMemo, useRef, useEffect } from 'react';
import { Fuel, Save, ArrowLeft, AlertTriangle, Camera, Loader2, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import SearchSelect from '@/components/SearchSelect';
import { api } from '@/api/apiClient';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { formatQtd, parseQtd } from '@/lib/format';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  carregarRascunhoAbastecimento,
  limparRascunhoAbastecimento,
  salvarRascunhoAbastecimento,
} from '@/lib/abastecimentoOffline';

async function otimizarFotoMobile(file) {
  if (
    !file
    || !String(file.type || '').startsWith('image/')
    || file.size < 900 * 1024
  ) {
    return file;
  }

  const url = URL.createObjectURL(file);

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });

    const largura = image.naturalWidth || image.width;
    const altura = image.naturalHeight || image.height;
    const maior = Math.max(largura, altura);

    if (!largura || !altura || maior <= 1600) {
      return file;
    }

    const escala = 1600 / maior;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(largura * escala));
    canvas.height = Math.max(1, Math.round(altura * escala));

    const context = canvas.getContext('2d');
    if (!context) return file;

    context.drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82)
    );

    if (!blob || blob.size >= file.size) {
      return file;
    }

    return new File(
      [blob],
      'abastecimento-' + Date.now() + '.jpg',
      { type: 'image/jpeg' }
    );
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function AbastecimentoForm({
  maquina,
  combustiveis,
  produtoPredefinido,
  saving,
  fotoOpcional,
  userId,
  onSubmit,
  onBack,
}) {
  const isMobile = useIsMobile();
  const [produtoId, setProdutoId] = useState(produtoPredefinido?.id || '');
  const [quantidade, setQuantidade] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState('');
  const [fotoUrl, setFotoUrl] = useState('');
  const [fotoFile, setFotoFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [rascunhoCarregado, setRascunhoCarregado] = useState(false);
  const fileRef = useRef(null);

  // Sincroniza quando o combustível predefinido da máquina muda.
  useEffect(() => {
    if (produtoPredefinido) setProdutoId(produtoPredefinido.id);
  }, [produtoPredefinido]);

  useEffect(() => {
    return () => {
      if (fotoPreview) {
        URL.revokeObjectURL(fotoPreview);
      }
    };
  }, [fotoPreview]);

  useEffect(() => {
    if (!isMobile || !userId || !maquina?.id) {
      setRascunhoCarregado(true);
      return undefined;
    }

    let active = true;

    carregarRascunhoAbastecimento({
      userId,
      maquinaId: maquina.id,
    }).then((rascunho) => {
      if (!active) return;

      if (rascunho) {
        if (rascunho.produto_id) {
          setProdutoId(rascunho.produto_id);
        }

        setQuantidade(
          String(rascunho.quantidade || '')
        );
        setObservacao(
          rascunho.observacao || ''
        );

        if (rascunho.foto_blob) {
          const file = rascunho.foto_blob instanceof File
            ? rascunho.foto_blob
            : new File(
                [rascunho.foto_blob],
                rascunho.foto_nome || 'abastecimento.jpg',
                {
                  type:
                    rascunho.foto_tipo
                    || rascunho.foto_blob.type
                    || 'image/jpeg',
                }
              );

          setFotoFile(file);
          setFotoPreview(
            URL.createObjectURL(file)
          );
        }
      }

      setRascunhoCarregado(true);
    });

    return () => {
      active = false;
    };
  }, [
    isMobile,
    userId,
    maquina?.id,
  ]);

  useEffect(() => {
    if (
      !isMobile
      || !userId
      || !maquina?.id
      || !rascunhoCarregado
    ) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      salvarRascunhoAbastecimento({
        userId,
        maquinaId: maquina.id,
        produtoId,
        quantidade,
        observacao,
        fotoFile,
      }).catch(() => {
        // O rascunho é uma proteção extra e não bloqueia o formulário.
      });
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    isMobile,
    userId,
    maquina?.id,
    produtoId,
    quantidade,
    observacao,
    fotoFile,
    rascunhoCarregado,
  ]);

  const produto = useMemo(
    () => combustiveis.find((p) => p.id === produtoId),
    [combustiveis, produtoId]
  );

  const qtd = parseQtd(quantidade);
  const podeSalvar = produto && qtd > 0 && !saving && !uploading;

  async function handleFoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setErro('');

    if (fotoPreview) {
      URL.revokeObjectURL(fotoPreview);
    }

    if (isMobile) {
      setFotoFile(file);
      setFotoUrl('');
      setFotoPreview(
        URL.createObjectURL(file)
      );
      setUploading(true);

      try {
        const otimizada = await otimizarFotoMobile(file);

        if (otimizada !== file) {
          setFotoFile(otimizada);
          setFotoPreview(
            URL.createObjectURL(otimizada)
          );
        }
      } finally {
        setUploading(false);
      }

      return;
    }

    setUploading(true);

    try {
      const { file_url } = await api.integrations.Core.UploadFile({ file });
      setFotoUrl(file_url);
      setFotoFile(null);
      setFotoPreview('');
    } catch {
      setErro('Falha ao enviar a foto. Tente novamente.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    if (!produto) { setErro('Selecione o combustível.'); return; }
    if (!(qtd > 0)) { setErro('Informe uma quantidade maior que zero.'); return; }
    if (!fotoOpcional && !fotoUrl && !fotoFile) { setErro('Tire a foto do painel do abastecedor para confirmação.'); return; }
    try {
      await onSubmit({ produto, quantidade: qtd, observacao, foto_url: fotoUrl, foto_file: fotoFile });
      if (isMobile) {
        await limparRascunhoAbastecimento({ userId });
      }
      if (fotoPreview) URL.revokeObjectURL(fotoPreview);
      setProdutoId(''); setQuantidade(''); setObservacao(''); setFotoUrl(''); setFotoFile(null); setFotoPreview('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setErro(err.message || 'Erro ao registrar abastecimento.');
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1">
        <Button size="icon" variant="ghost" onClick={onBack} className="-ml-2">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h3 className="font-semibold leading-tight">Abastecer — {maquina.nome}</h3>
          <p className="text-xs font-mono text-muted-foreground">{maquina.codigo}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 mt-3">
        <div className="space-y-1.5">
          {produtoPredefinido ? (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2.5 shadow-sm">
              <Fuel className="w-4 h-4 text-white shrink-0" />
              <span className="font-semibold text-white">{produtoPredefinido.nome}</span>
              <span className="ml-auto text-sm font-medium text-white">
                {produto ? `${formatQtd(produto.quantidade || 0)} ${produto.unidade || 'un'}` : '—'}
              </span>
            </div>
          ) : (
            <SearchSelect
              value={produtoId}
              onChange={(v) => { setProdutoId(v); setErro(''); }}
              placeholder="Buscar combustível..."
              options={combustiveis.map((p) => ({ value: p.id, label: `${p.nome} — ${formatQtd(p.quantidade || 0)} ${p.unidade || 'un'}` }))}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ab-qtd">Quantidade abastecida *</Label>
          <Input
            id="ab-qtd"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label>Foto do painel do abastecedor{fotoOpcional ? '' : ' *'}</Label>
          {(fotoUrl || fotoPreview) ? (
            <div className="relative rounded-lg overflow-hidden border">
              <img src={fotoPreview || resolveMediaUrl(fotoUrl)} alt="Painel" className="w-full max-h-56 object-cover" />
              <button
                type="button"
                onClick={() => { if (fotoPreview) URL.revokeObjectURL(fotoPreview); setFotoUrl(''); setFotoFile(null); setFotoPreview(''); if (fileRef.current) fileRef.current.value = ''; }}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="absolute bottom-2 left-2 flex items-center gap-1 text-xs text-white bg-black/60 px-2 py-0.5 rounded">
                <CheckCircle2 className="w-3 h-3" /> Foto capturada
              </div>
            </div>
          ) : (
            <label htmlFor="ab-foto" className="flex flex-col items-center justify-center gap-2 h-28 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent transition-colors text-muted-foreground">
              {uploading ? (
                <><Loader2 className="w-6 h-6 animate-spin" /><span className="text-xs">{isMobile ? 'Preparando foto…' : 'Enviando foto…'}</span></>
              ) : (
                <><Camera className="w-6 h-6" /><span className="text-xs">Tirar foto do painel</span></>
              )}
            </label>
          )}
          <input
            ref={fileRef}
            id="ab-foto"
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFoto}
          />
          <p className="text-xs text-muted-foreground">
            {fotoOpcional
              ? 'Foto opcional para este usuário.'
              : 'A foto será enviada junto com o abastecimento e ficará disponível para conferência.'}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ab-obs">Observação</Label>
          <Textarea id="ab-obs" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" />
        </div>

        {erro && (
          <p className="text-sm text-destructive flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> {erro}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={!podeSalvar}>
          {saving ? <><Save className="w-4 h-4 mr-2 animate-pulse" /> Registrando…</> : <><Fuel className="w-4 h-4 mr-2" /> Registrar Abastecimento</>}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          O estoque não é baixado agora. Um usuário autorizado confirmará a baixa após conferir a foto.
        </p>
      </form>
    </Card>
  );
}
