import { AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';

export default function AlertsPanel({ baixoCount, zeradoCount }) {
  const hasAlerts = baixoCount > 0 || zeradoCount > 0;

  return (
    <Card className="p-5">
      <h3 className="font-semibold text-base mb-4 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-500" />
        Alertas de Estoque
      </h3>
      <div className="space-y-3">
        {zeradoCount > 0 && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-900">
                {zeradoCount} produto{zeradoCount > 1 ? 's' : ''} zerado{zeradoCount > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-red-600">Reposição crítica necessária</p>
            </div>
          </div>
        )}
        {baixoCount > 0 && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-900">
                {baixoCount} produto{baixoCount > 1 ? 's' : ''} com estoque baixo
              </p>
              <p className="text-xs text-amber-600">Atenção à reposição</p>
            </div>
          </div>
        )}
        {!hasAlerts && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-900">Tudo em ordem</p>
              <p className="text-xs text-green-600">Nenhum alerta no momento</p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}