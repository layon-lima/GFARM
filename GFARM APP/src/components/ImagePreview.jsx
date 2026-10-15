import { useState } from 'react';
import { ImageIcon } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { resolveMediaUrl } from '@/lib/mediaUrl';

export default function ImagePreview({
  src,
  alt = 'Imagem',
  className = '',
  fallbackClassName = '',
  fallbackIconClassName = 'h-4 w-4',
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const imageUrl = resolveMediaUrl(src);

  if (!imageUrl || error) {
    return (
      <div className={fallbackClassName}>
        <ImageIcon className={fallbackIconClassName} />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="block cursor-zoom-in"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Ampliar ${alt}`}
      >
        <img
          src={imageUrl}
          alt={alt}
          className={className}
          onError={() => setError(true)}
        />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl p-3 sm:p-5">
          <DialogHeader className="sr-only">
            <DialogTitle>{alt}</DialogTitle>
          </DialogHeader>
          <img
            src={imageUrl}
            alt={alt}
            className="max-h-[82vh] w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
