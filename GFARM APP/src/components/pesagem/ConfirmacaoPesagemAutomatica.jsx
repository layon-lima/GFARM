import { CheckCircle2, Clock3, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';


// Primeiro congela o peso; o botão Confirmar registra imediatamente,
// e o fim dos 10 segundos também confirma automaticamente.
// Cancelar impede a gravação e oferece nova pesagem ou modo manual.
export default function ConfirmacaoPesagemAutomatica({
  captura,
  segundos,
  salvando,
  onConfirmar,
  onCancelar,
  onPesarNovamente,
  onEncerrar,
}) {
  if (!captura) return null;

  const confirmando = captura.fase === 'confirmar';

  return (
    <AlertDialog open onOpenChange={() => {}}>
      <AlertDialogContent
        className="w-[calc(100%_-_1.5rem)] max-w-md gap-4"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center justify-center gap-2 text-base sm:justify-start">
            {confirmando
              ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              : <ShieldAlert className="h-5 w-5 text-amber-600" />}
            {confirmando ? 'Confirmar pesagem automática' : 'Pesagem não registrada'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmando
              ? `A Toledo identificou a ${captura.etapa}ª pesagem estável. Confirme, cancele ou aguarde: em 10 segundos este peso será registrado automaticamente.`
              : (captura.motivo || 'A captura foi cancelada. Escolha como deseja continuar.')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {captura.etapa}ª pesagem — peso identificado
          </p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-primary sm:text-5xl">
            {Number(captura.peso).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}{' '}
            <span className="text-base font-medium">kg</span>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {confirmando
              ? 'Peso congelado: confirmação automática ao fim da contagem, se ninguém cancelar.'
              : 'Captura cancelada: este peso não foi registrado.'}
          </p>
        </div>

        {confirmando ? (
          <>
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-medium">
                <Clock3 className="h-4 w-4" /> Confirma automaticamente em
              </span>
              <span className={`text-xl font-bold tabular-nums ${segundos <= 3 ? 'text-destructive' : 'text-primary'}`}>
                {segundos} s
              </span>
            </div>
            <AlertDialogFooter className="gap-2 sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:flex-1"
                disabled={salvando}
                onClick={onCancelar}
              >
                <XCircle className="mr-2 h-4 w-4" /> Cancelar
              </Button>
              <Button
                type="button"
                className="w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-1"
                disabled={salvando || segundos <= 0}
                onClick={onConfirmar}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {salvando ? 'Registrando...' : 'Confirmar e registrar'}
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Pesar novamente: aguarda 3 segundos e reinicia a busca por 3 segundos de peso estável.
              Cancelar automação: devolve a captura ao usuário.
            </p>
            <AlertDialogFooter className="gap-2 sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:flex-1"
                disabled={salvando}
                onClick={onEncerrar}
              >
                <XCircle className="mr-2 h-4 w-4" /> Cancelar automação
              </Button>
              <Button
                type="button"
                className="w-full sm:flex-1"
                disabled={salvando}
                onClick={onPesarNovamente}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Pesar novamente
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
