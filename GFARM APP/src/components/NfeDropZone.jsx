import { useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

function isXmlFile(file) {
  if (!file) return false;
  const name = (file.name || '').toLowerCase();
  return (
    name.endsWith('.xml') ||
    file.type === 'text/xml' ||
    file.type === 'application/xml'
  );
}

export default function NfeDropZone({ onDropFile, disabled, children }) {
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  // Impede o navegador de abrir arquivos soltos fora da zona
  useEffect(() => {
    const prevent = (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  function handleDragEnter(e) {
    if (disabled) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragging(false);
    }
  }

  function handleDragOver(e) {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  }

  function handleDrop(e) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file || !isXmlFile(file)) return;
    onDropFile?.(file);
  }

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {dragging && (
        <div className="hidden md:flex absolute inset-0 z-50 items-center justify-center pointer-events-none rounded-xl bg-primary/10 border-2 border-dashed border-primary">
          <div className="flex flex-col items-center gap-2 text-primary">
            <UploadCloud className="w-10 h-10" />
            <p className="font-semibold">Solte o XML da NF-e para registrar a entrada</p>
          </div>
        </div>
      )}
    </div>
  );
}