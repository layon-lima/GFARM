import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';

export default function ProdutoFotoUpload({ value, onChange }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Arquivo inválido', description: 'Selecione uma imagem.' });
      return;
    }
    setUploading(true);
    try {
      const { file_url } = await api.integrations.Core.UploadFile({ file });
      onChange(file_url);
      toast({ title: 'Imagem anexada' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao enviar imagem', description: err?.message });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {value ? (
        <div className="relative w-16 h-16 rounded-lg overflow-hidden border shrink-0">
          <Image src={value} alt="Referência" className="w-full h-full" fittingType="cover" />
        </div>
      ) : (
        <div className="w-16 h-16 rounded-lg border border-dashed flex items-center justify-center text-muted-foreground shrink-0">
          <ImagePlus className="w-5 h-5" />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 w-fit"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
          {value ? 'Trocar foto' : 'Adicionar foto'}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" className="gap-1.5 h-8 w-fit text-destructive hover:text-destructive" onClick={() => onChange('')}>
            <Trash2 className="w-3.5 h-3.5" /> Remover
          </Button>
        )}
      </div>
    </div>
  );
}