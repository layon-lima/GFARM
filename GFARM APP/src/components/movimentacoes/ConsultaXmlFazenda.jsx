import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileUp, FolderOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Janela de consulta + recebimento do XML.
 * Páginas da SEFAZ são de outro domínio e podem bloquear iframe.
 * O navegador não permite ler arquivos baixados por outro site sem que
 * o operador os selecione ou arraste para cá.
 */
export default function ConsultaXmlFazenda({ nota, link, onImportar, onClose }) {
  const [arrastando, setArrastando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [pasta, setPasta] = useState(null);
  const [statusPasta, setStatusPasta] = useState('');
  const arquivoRef = useRef(null);
  const importandoRef = useRef(false);
  const varrendoRef = useRef(false);
  const arquivosVistosRef = useRef(new Set());
  const iniciouEmRef = useRef(0);

  async function importar(arquivo) {
    if (!arquivo || importandoRef.current) return null;
    importandoRef.current = true;
    setResultado(null);
    setProcessando(true);
    try {
      const res = await onImportar(arquivo);
      if (res) setResultado(res);
      return res;
    } finally {
      importandoRef.current = false;
      setProcessando(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  }

  async function autorizarPasta() {
    if (typeof window.showDirectoryPicker !== 'function') {
      setStatusPasta('Seu navegador não oferece monitoramento de pasta. Use o botão de selecionar XML.');
      return;
    }
    try {
      // A permissão é apenas de LEITURA e vale para esta janela.
      const handle = await window.showDirectoryPicker({
        mode: 'read', startIn: 'downloads', id: 'gfarm-xml-nfe',
      });
      iniciouEmRef.current = Date.now();
      arquivosVistosRef.current.clear();
      setStatusPasta('Pasta autorizada: aguardando XML novo com a chave desta nota...');
      setPasta(handle);
    } catch (erro) {
      if (erro?.name === 'AbortError') {
        setStatusPasta('Pasta não autorizada. Você ainda pode selecionar ou arrastar o XML.');
      } else {
        setStatusPasta('O navegador não permitiu acessar a pasta. Use Selecionar XML.');
      }
    }
  }

  useEffect(() => {
    if (!pasta) return undefined;
    let ativo = true;
    async function verificar() {
      if (!ativo || varrendoRef.current || importandoRef.current) return;
      varrendoRef.current = true;
      try {
        let examinados = 0;
        for await (const handle of pasta.values()) {
          if (!ativo || ++examinados > 4000) break;
          if (handle.kind !== 'file' || !/\.xml$/i.test(handle.name)) continue;
          const arquivo = await handle.getFile();
          if (arquivo.size < 50 || arquivo.size > 3 * 1024 * 1024 ||
              arquivo.lastModified < iniciouEmRef.current - 20000) continue;
          const idArquivo = handle.name + ':' + arquivo.size + ':' + arquivo.lastModified;
          if (arquivosVistosRef.current.has(idArquivo)) continue;
          arquivosVistosRef.current.add(idArquivo);

          // Confere a chave NO NAVEGADOR antes de enviar o arquivo.
          const documento = new DOMParser().parseFromString(await arquivo.text(), 'application/xml');
          const nfe = documento.getElementsByTagNameNS('*', 'infNFe')[0];
          const protocolo = documento.getElementsByTagNameNS('*', 'chNFe')[0];
          const chaveDoArquivo = nfe?.getAttribute('Id')?.replace(/^NFe/, '') ||
            protocolo?.textContent?.trim() || '';
          if (chaveDoArquivo !== String(nota.chave_acesso || '').replace(/\D/g, '')) continue;
          const numeroXml = documento.getElementsByTagNameNS('*', 'nNF')[0]?.textContent?.trim() || '';
          if (numeroXml.replace(/^0+/, '') !== String(nota.numero_nota || '').replace(/^0+/, '')) continue;
          const importado = await importar(arquivo);
          if (importado && ativo) {
            setStatusPasta('XML desta NF-e detectado e importado automaticamente.');
            setPasta(null);
            break;
          }
        }
      } catch {
        if (ativo) {
          setStatusPasta('Não foi possível continuar lendo a pasta. Selecione ou arraste o XML.');
          setPasta(null);
        }
      } finally {
        varrendoRef.current = false;
      }
    }
    verificar();
    const timer = setInterval(verificar, 2500);
    return () => { ativo = false; clearInterval(timer); };
  }, [pasta, nota.chave_acesso, nota.numero_nota]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-2 md:p-4"
      role="presentation" onMouseDown={event => {
        if (event.target === event.currentTarget && !processando) onClose();
      }}>
      <div className="flex h-[94vh] w-full max-w-[1300px] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
        role="dialog" aria-modal="true" aria-label="Consultar e importar XML da NF-e">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="text-base font-bold">Consulta e importação da NF-e {nota.numero_nota}</h2>
            <p className="text-xs text-muted-foreground">
              Uma importação preenche todas as entradas pendentes identificadas nesta mesma chave.
              A aprovação de estoque continua manual.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={processando}>
            <X className="mr-1 h-4 w-4" /> Fechar
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
          <section className="flex min-h-[400px] flex-col overflow-hidden rounded-lg border lg:min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
              <div className="text-xs font-semibold">Portal Nacional da NF-e — consulta completa</div>
              <a href={link} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-semibold text-primary hover:bg-muted">
                <ExternalLink className="h-3.5 w-3.5" /> Abrir no navegador
              </a>
            </div>
            {link ? (
              <iframe title="Portal Nacional da NF-e" src={link} referrerPolicy="no-referrer"
                className="min-h-[360px] w-full flex-1 bg-white" />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">
                A chave fiscal desta nota não contém 44 dígitos válidos.
              </p>
            )}
          </section>
          <aside className="space-y-3 overflow-y-auto">
            <div className="rounded-lg border p-3">
              <div className="mb-1 text-sm font-bold">XML desta nota</div>
              <p className="break-all font-mono text-[11px]">{nota.chave_acesso || 'Chave indisponível'}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                Consulte a nota na Fazenda e use “Download do Documento” quando disponível.
                O portal pode exigir captcha e certificado digital.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Se o portal bloquear a janela interna, use “Abrir no navegador”.
                O download fica na pasta do navegador. Você pode autorizar o monitoramento
                abaixo ou selecionar e arrastar o arquivo manualmente.
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs font-semibold">Detectar o XML ao baixar</div>
              <p className="mt-1 text-xs text-muted-foreground">
                No Chrome ou Edge, autorize uma pasta de downloads uma vez.
                Enquanto esta janela estiver aberta, o GFARM procura novos XMLs
                com a chave desta nota e importa automaticamente. Não lê outras
                notas para o servidor.
              </p>
              <Button variant="outline" size="sm" className="mt-2"
                onClick={pasta ? () => { setPasta(null); setStatusPasta('Monitoramento interrompido.'); } : autorizarPasta}
                disabled={processando}>
                <FolderOpen className="mr-1 h-4 w-4" />
                {pasta ? 'Parar monitoramento' : 'Autorizar pasta de downloads'}
              </Button>
              {!!statusPasta && <p className="mt-2 text-[11px] text-muted-foreground" role="status">{statusPasta}</p>}
            </div>
            <div
              className={'rounded-lg border-2 border-dashed p-4 text-center ' +
                (arrastando ? 'border-primary bg-primary/10' : 'border-border bg-muted/10')}
              onDragOver={event => { event.preventDefault(); setArrastando(true); }}
              onDragLeave={event => { event.preventDefault(); setArrastando(false); }}
              onDrop={event => {
                event.preventDefault();
                setArrastando(false);
                importar(event.dataTransfer.files?.[0]);
              }}>
              <FileUp className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
              <div className="text-sm font-semibold">Solte o XML baixado aqui</div>
              <div className="mt-1 text-xs text-muted-foreground">Ou selecione o arquivo uma única vez para toda a NF-e</div>
              <input ref={arquivoRef} type="file" accept=".xml,application/xml,text/xml"
                className="sr-only" disabled={processando}
                onChange={event => importar(event.target.files?.[0])} />
              <Button className="mt-3" variant="outline" size="sm"
                disabled={processando} onClick={() => arquivoRef.current?.click()}>
                <FileUp className="mr-1 h-4 w-4" />
                {processando ? 'Conferindo XML...' : 'Selecionar XML'}
              </Button>
            </div>
            {resultado && (
              <div className="rounded-lg border p-3" role="status">
                <div className="text-sm font-bold">XML conferido</div>
                <p className="mt-1 text-xs">
                  {resultado.itens_atualizados} entrada(s) pendente(s) preenchida(s)
                  com os dados fiscais.
                </p>
                {!!resultado.nao_identificados?.length && (
                  <div className="mt-2 text-xs text-amber-700">
                    Conferir manualmente: {resultado.nao_identificados.join(', ')}
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Nenhum produto entrou no estoque. Confira os dados e aprove as entradas individualmente.
                </p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
