import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NfeImportButton({ importing, onFile }) {
  const inputRef = useRef(null);

  function handleChange(e) {
    const file = e.target.files?.[0];
    if (file) onFile?.(file);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xml"
        className="hidden"
        onChange={handleChange}
      />
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={importing}
        onClick={() => inputRef.current?.click()}
      >
        {importing ? (
          <>
            <div className="w-4 h-4 border-2 border-muted border-t-primary rounded-full animate-spin mr-2" />
            Importando…
          </>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" />
            Importar XML (NF-e)
          </>
        )}
      </Button>
    </>
  );
}