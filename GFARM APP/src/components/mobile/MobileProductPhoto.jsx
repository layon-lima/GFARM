import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

export const PRODUCT_PHOTO_ACCEPT = 'image/*';
export const PRODUCT_PHOTO_CAPTURE = 'environment';

export default function MobileProductPhoto({
  uploading = false,
  onBeforeOpen,
  onFile,
}) {
  const videoRef = useRef(null);
  const fallbackCameraRef = useRef(null);
  const galleryRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');

  function stopCamera() {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOpen(false);
  }

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (!cameraOpen || !streamRef.current || !videoRef.current) return;

    videoRef.current.srcObject = streamRef.current;
    videoRef.current.play().catch(() => {
      setCameraError('Toque novamente em Tirar foto para ativar a câmera.');
    });
  }, [cameraOpen]);

  async function abrirCamera() {
    onBeforeOpen?.();
    setCameraError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      fallbackCameraRef.current?.click();
      return;
    }

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
        },
        audio: false,
      });
      setCameraOpen(true);
    } catch {
      fallbackCameraRef.current?.click();
    }
  }

  async function entregarArquivo(file, inputRef) {
    if (!file) return;

    try {
      await onFile?.(file);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function capturar() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight) {
      setCameraError('A câmera ainda está iniciando.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');
    context?.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          setCameraError('Não foi possível capturar a foto.');
          return;
        }

        const file = new File(
          [blob],
          `produto-${Date.now()}.jpg`,
          { type: 'image/jpeg' }
        );

        stopCamera();
        await onFile?.(file);
      },
      'image/jpeg',
      0.88
    );
  }

  return (
    <div className="space-y-3">
      <input
        ref={fallbackCameraRef}
        className="hidden"
        type="file"
        accept={PRODUCT_PHOTO_ACCEPT}
        capture={PRODUCT_PHOTO_CAPTURE}
        onChange={(event) => entregarArquivo(event.target.files?.[0], fallbackCameraRef)}
      />

      <input
        ref={galleryRef}
        className="hidden"
        type="file"
        accept={PRODUCT_PHOTO_ACCEPT}
        onChange={(event) => entregarArquivo(event.target.files?.[0], galleryRef)}
      />

      {cameraOpen ? (
        <div className="space-y-3 rounded-2xl border bg-black p-2">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="max-h-[58vh] w-full rounded-xl object-cover"
          />

          {cameraError ? (
            <p className="px-2 text-sm text-red-300">{cameraError}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={stopCamera}>
              <X className="mr-2 h-4 w-4" />
              Cancelar
            </Button>

            <Button type="button" onClick={capturar} disabled={uploading}>
              <Camera className="mr-2 h-4 w-4" />
              Capturar
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={abrirCamera}
          >
            <Camera className="mr-2 h-4 w-4" />
            Tirar foto
          </Button>

          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => {
              onBeforeOpen?.();
              galleryRef.current?.click();
            }}
          >
            <ImagePlus className="mr-2 h-4 w-4" />
            Galeria
          </Button>
        </div>
      )}

      {uploading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Enviando foto…
        </p>
      ) : null}
    </div>
  );
}
