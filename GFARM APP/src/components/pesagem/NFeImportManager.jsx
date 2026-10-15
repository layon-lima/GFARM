import { useState, useCallback } from 'react';
import { UploadCloud, FileCheck2, FileX2, FileQuestion, Loader2, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/api/apiClient';
import { parseNfeVendaXml } from '@/lib/nfeVendaParser';
import { matchNfeToTicket } from '@/lib/nfeMatching';
import { formatPlaca, formatKg } from '@/lib/pesagem';
import NfeBadge from './NfeBadge';

const STATUS_ICON = {
  matched: CheckCircle2,
  ambiguous: FileQuestion,
  none: FileX2,
  duplicate: FileCheck2,
  error: AlertTriangle,
  pending: FileText,
};

const STATUS_COLOR = {
  matched: 'text-emerald-600',
  ambiguous: 'text-amber-500',
  none: 'text-red-500',
  duplicate: 'text-blue-500',
  error: 'text-red-500',
  pending: 'text-muted-foreground',
};

export default function NFeImportManager({ tickets, onReload }) {
  const [processando, setProcessando] = useState(false);
  const [resultados, setResultados] = useState([]);
  const { toast } = useToast();

  // Passa TODOS os tickets para o matcher — ele filtra internamente.
  // Assim a busca por número de ticket (extraído do infCpl) funciona mesmo
  // se o tipo/status do ticket divergir do esperado.
  const todosTickets = tickets;

  const processarArquivo = useCallback(async (file, ticketList) => {
    let xmlText;
    try {
      xmlText = await file.text();
    } catch {
      return { fileName: file.name, status: 'error', message: 'Não foi possível ler o arquivo.' };
    }

    let nfeData;
    try {
      nfeData = parseNfeVendaXml(xmlText);
    } catch (err) {
      return { fileName: file.name, status: 'error', message: err.message || 'XML inválido.' };
    }

    if (!nfeData.chave) {
      return { fileName: file.name, status: 'error', message: 'Chave de acesso não encontrada no XML.' };
    }

    const match = matchNfeToTicket(nfeData, ticketList);

    if (match.status === 'duplicate') {
      return {
        fileName: file.name,
        status: 'duplicate',
        nfeData,
        message: `NF ${nfeData.nNF} já vinculada ao ticket ${match.ticket.numero}.`,
      };
    }

    if (match.status === 'none') {
      return {
        fileName: file.name,
        status: 'none',
        nfeData,
        numeroTicketExtraido: nfeData.numeroTicket,
        message: match.motivo || 'Nenhum ticket corresponde a esta NF-e.',
      };
    }

    if (match.status === 'ambiguous') {
      return {
        fileName: file.name,
        status: 'ambiguous',
        nfeData,
        candidates: match.candidates,
        message: `${match.candidates.length} tickets candidatos — confirme o correto.`,
      };
    }

    // Match único — marca automaticamente
    try {
      await api.entities.TicketPesagem.update(match.ticket.id, {
        nfe_importada: true,
        nfe_numero: nfeData.nNF,
        nfe_produto: nfeData.produto,
        nfe_motorista: nfeData.motorista,
        nfe_chave: nfeData.chave,
      });
      return {
        fileName: file.name,
        status: 'matched',
        nfeData,
        ticket: { ...match.ticket, nfe_importada: true, nfe_numero: nfeData.nNF },
        message: `Vinculada ao ticket ${match.ticket.numero}.`,
      };
    } catch (err) {
      return {
        fileName: file.name,
        status: 'error',
        nfeData,
        message: `Erro ao marcar ticket: ${err.message || err}`,
      };
    }
  }, []);

  const handleFiles = useCallback(async (files) => {
    const xmlFiles = Array.from(files).filter((f) => {
      const name = (f.name || '').toLowerCase();
      return name.endsWith('.xml') || f.type === 'text/xml' || f.type === 'application/xml';
    });

    if (xmlFiles.length === 0) {
      toast({ variant: 'destructive', title: 'Nenhum arquivo XML encontrado' });
      return;
    }

    setProcessando(true);
    const novosResultados = [];

    for (const file of xmlFiles) {
      const resultado = await processarArquivo(file, todosTickets);
      novosResultados.push(resultado);
      setResultados((prev) => [resultado, ...prev]);
    }

    setProcessando(false);

    const matched = novosResultados.filter((r) => r.status === 'matched').length;
    const ambiguous = novosResultados.filter((r) => r.status === 'ambiguous').length;
    const none = novosResultados.filter((r) => r.status === 'none').length;
    const duplicates = novosResultados.filter((r) => r.status === 'duplicate').length;

    if (matched > 0) onReload();

    toast({
      title: 'Importação concluída',
      description: `${matched} vinculada(s) · ${ambiguous} pendente(s) de confirmação · ${none} sem match · ${duplicates} duplicada(s).`,
    });
  }, [todosTickets, processarArquivo, toast, onReload]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) handleFiles(files);
  }, [handleFiles]);

  const handleInputChange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) handleFiles(files);
    if (e.target) e.target.value = '';
  };

  async function confirmarVinculo(resultado, ticket) {
    setProcessando(true);
    try {
      await api.entities.TicketPesagem.update(ticket.id, {
        nfe_importada: true,
        nfe_numero: resultado.nfeData.nNF,
        nfe_produto: resultado.nfeData.produto,
        nfe_motorista: resultado.nfeData.motorista,
        nfe_chave: resultado.nfeData.chave,
      });
      setResultados((prev) =>
        prev.map((r) =>
          r === resultado
            ? { ...r, status: 'matched', ticket: { ...ticket, nfe_importada: true, nfe_numero: resultado.nfeData.nNF }, message: `Vinculada ao ticket ${ticket.numero}.`, candidates: undefined }
            : r
        )
      );
      onReload();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao vincular', description: String(err?.message || err) });
    } finally {
      setProcessando(false);
    }
  }

  const stats = {
    total: resultados.length,
    matched: resultados.filter((r) => r.status === 'matched').length,
    ambiguous: resultados.filter((r) => r.status === 'ambiguous').length,
    none: resultados.filter((r) => r.status === 'none').length,
    duplicate: resultados.filter((r) => r.status === 'duplicate').length,
    error: resultados.filter((r) => r.status === 'error').length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileCheck2 className="w-4 h-4" />
        <span>Importe os XMLs das NF-e de venda. O sistema identifica o ticket pelo número informado na nota, ou por placa + peso.</span>
      </div>

      {/* Drop zone */}
      <div
        className="relative border-2 border-dashed border-border rounded-xl p-8 text-center transition-colors hover:border-primary/50 cursor-pointer"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={handleDrop}
        onClick={() => document.getElementById('nfe-xml-input')?.click()}
      >
        <input
          id="nfe-xml-input"
          type="file"
          accept=".xml"
          multiple
          className="hidden"
          onChange={handleInputChange}
        />
        <div className="flex flex-col items-center gap-2 pointer-events-none">
          {processando ? (
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
          ) : (
            <UploadCloud className="w-10 h-10 text-muted-foreground" />
          )}
          <p className="font-semibold text-sm">
            {processando ? 'Processando XMLs…' : 'Arraste os XMLs da NF-e aqui ou clique para selecionar'}
          </p>
          <p className="text-xs text-muted-foreground">Você pode importar vários arquivos de uma vez</p>
        </div>
      </div>

      {/* Stats */}
      {resultados.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Total: {stats.total}</Badge>
          {stats.matched > 0 && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">Vinculadas: {stats.matched}</Badge>}
          {stats.ambiguous > 0 && <Badge className="bg-amber-100 text-amber-700 border-amber-300">Pendentes: {stats.ambiguous}</Badge>}
          {stats.none > 0 && <Badge className="bg-red-100 text-red-700 border-red-300">Sem match: {stats.none}</Badge>}
          {stats.duplicate > 0 && <Badge className="bg-blue-100 text-blue-700 border-blue-300">Duplicadas: {stats.duplicate}</Badge>}
          {stats.error > 0 && <Badge variant="destructive">Erros: {stats.error}</Badge>}
        </div>
      )}

      {/* Resultados */}
      {resultados.length > 0 && (
        <div className="space-y-2 max-h-[55vh] overflow-auto scrollbar-thin pr-1">
          {resultados.map((r, i) => {
            const Icon = STATUS_ICON[r.status] || FileText;
            const color = STATUS_COLOR[r.status] || 'text-muted-foreground';
            return (
              <Card key={i} className="p-3">
                <div className="flex items-start gap-3">
                  <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${color}`} />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{r.fileName}</span>
                      {r.nfeData?.nNF && <Badge variant="outline" className="text-[10px]">NF {r.nfeData.nNF}</Badge>}
                      {r.nfeData?.placa && <span className="text-xs font-mono text-muted-foreground">{formatPlaca(r.nfeData.placa)}</span>}
                      {r.nfeData?.pesoLiquido > 0 && <span className="text-xs text-muted-foreground">{formatKg(r.nfeData.pesoLiquido)}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{r.message}</p>
                    {r.numeroTicketExtraido && (
                      <p className="text-[11px] text-amber-600 font-medium">
                        Ticket extraído da nota: <span className="font-mono">{r.numeroTicketExtraido}</span>
                      </p>
                    )}

                    {/* Trecho do rodapé (infCpl) para conferência quando não houve match automático */}
                    {(r.status === 'none' || r.status === 'ambiguous') && r.nfeData?.infCpl && (
                      <details className="mt-1">
                        <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                          Ver rodapé da nota (informações complementares)
                        </summary>
                        <p className="mt-1 text-[11px] text-muted-foreground bg-muted/40 rounded p-2 whitespace-pre-wrap max-h-32 overflow-auto scrollbar-thin">
                          {r.nfeData.infCpl}
                        </p>
                      </details>
                    )}

                    {/* Candidatos para confirmação manual */}
                    {r.status === 'ambiguous' && r.candidates?.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {r.candidates.map((c) => (
                          <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 bg-muted/30">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="font-mono text-xs font-semibold">{c.numero}</span>
                              <span className="text-xs truncate">{c.motorista}</span>
                              <span className="text-xs font-mono text-muted-foreground">{formatPlaca(c.placa)}</span>
                              <span className="text-xs text-muted-foreground">{formatKg(c.peso_liquido)}</span>
                              <NfeBadge ticket={c} size="xs" />
                            </div>
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs shrink-0"
                              disabled={processando || c.nfe_importada}
                              onClick={() => confirmarVinculo(r, c)}
                            >
                              {c.nfe_importada ? 'Já tem NF' : 'Vincular'}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Detalhe do match */}
                    {r.status === 'matched' && r.ticket && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-mono text-xs font-semibold text-emerald-700">{r.ticket.numero}</span>
                        <span className="text-xs text-muted-foreground truncate">{r.ticket.motorista} · {formatPlaca(r.ticket.placa)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {resultados.length === 0 && !processando && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Nenhuma importação realizada ainda. Arraste um ou mais XMLs acima para começar.
        </p>
      )}
    </div>
  );
}