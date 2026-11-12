import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileUp, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ORIGIN = 'https://estoque.fazendanovohorizonte.com';

/**
 * O navegador bloqueia a leitura de downloads de outro site por uma PWA.
 * A extensão opcional Chrome/Edge detecta o arquivo .xml finalizado pelo
 * próprio navegador e encaminha SOMENTE arquivos da chave da NF-e selecionada.
 */
export default function ConsultaXmlFazenda({ nota, link, onImportar, onClose }) {
  const [arrastando, setArrastando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [extensao, setExtensao] = useState('Aguardando resposta da extensão GFARM...');
  const [capturaAtiva, setCapturaAtiva] = useState(false);
  const arquivoRef = useRef(null);
  const importandoRef = useRef(false);
  const nonceRef = useRef(crypto.randomUUID());
  const importarRef = useRef(null);

  async function importar(arquivo) {
    if (!arquivo || importandoRef.current) return null;
    if (!/\.xml$/i.test(arquivo.name) || arquivo.size > 3 * 1024 * 1024) {
      setExtensao('Use um arquivo XML da NF-e com até 3 MB.');
      return null;
    }
    importandoRef.current = true;
    setProcessando(true);
    setResultado(null);
    try {
      const res = await onImportar(arquivo);
      if (res) {
        setResultado(res);
        setExtensao('XML identificado e importado; confira os recebimentos.');
      }
      return res;
    } catch {
      setExtensao('Não foi possível importar este XML; confira a chave e tente novamente.');
      return null;
    } finally {
      importandoRef.current = false;
      setProcessando(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  }
  importarRef.current = importar;

  useEffect(() => {
    const nonce = nonceRef.current;
    let respondeu = false;
    const chave = String(nota.chave_acesso || '').replace(/\D/g, '');
    function receber(event) {
      if (event.source !== window || event.origin !== ORIGIN) return;
      const data = event.data;
      if (data?.channel !== 'GFARM_XML_EXTENSION' || data.nonce !== nonce) return;
      if (data.type === 'STATUS') {
        respondeu = true;
        setCapturaAtiva(Boolean(data.ok));
        setExtensao(data.message || (data.ok ? 'Captura automática ativada.' : 'Extensão não disponível.'));
      } else if (data.type === 'ERROR') {
        setExtensao(data.message || 'O download ocorreu, mas não foi possível ler o XML.');
      } else if (data.type === 'XML_DOWNLOADED' && data.chave === chave && data.base64) {
        try {
          const binary = atob(data.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const file = new File([bytes], data.arquivo || 'nota.xml', { type: 'application/xml' });
          importarRef.current?.(file);
        } catch {
          setExtensao('Arquivo XML capturado, mas não foi possível ler seus dados.');
        }
      }
    }
    window.addEventListener('message', receber);
    window.postMessage({ channel: 'GFARM_XML_UI', type: 'START',
      chave, numero: String(nota.numero_nota || ''), nonce }, ORIGIN);
    const timeout = setTimeout(() => {
      if (!respondeu) setExtensao('Extensão GFARM não detectada. Instale-a no Chrome/Edge ou importe manualmente.');
    }, 2200);
    return () => {
      clearTimeout(timeout);
      window.postMessage({ channel: 'GFARM_XML_UI', type: 'STOP', nonce }, ORIGIN);
      window.removeEventListener('message', receber);
    };
  }, [nota.chave_acesso, nota.numero_nota]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-2 md:p-4"
      role="presentation" onMouseDown={event => {
        if (event.target === event.currentTarget && !processando) onClose();
      }}>
      <div className="w-full max-w-[780px] space-y-3 overflow-y-auto rounded-xl border bg-background p-4 shadow-2xl md:p-5"
        role="dialog" aria-modal="true" aria-label="Capturar XML da NF-e no navegador">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Capturar XML — NF-e {nota.numero_nota}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Um único XML pode preencher todas as entradas pendentes desta nota. Nada entra no estoque sem aprovação.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={processando}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="rounded-lg border bg-muted/10 p-3">
          <div className="text-xs text-muted-foreground">Chave da NF-e</div>
          <div className="break-all font-mono text-xs font-semibold">{nota.chave_acesso || 'Não informada'}</div>
          <div className={'mt-2 text-xs font-medium ' + (capturaAtiva ? 'text-emerald-700' : 'text-amber-700')}
            role="status">{capturaAtiva ? '● ' : '○ '}{extensao}</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border p-3">
            <div className="text-sm font-bold">1. Consultar no FSist</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Abre no Chrome/Edge em outra aba. Com a extensão GFARM ativa, a chave pode ser preenchida
              no FSist, mas a validação de segurança e o certificado continuam obrigatórios quando exigidos.
            </p>
            <a href="https://www.fsist.com.br/" target="_blank" rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs font-semibold text-primary hover:bg-muted">
              <ExternalLink className="h-4 w-4" /> Abrir FSist
            </a>
            {link ? (
              <a href={link} target="_blank" rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline">
                Portal Nacional
              </a>
            ) : null}
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-sm font-bold">2. Baixar XML no navegador</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Quando o download .xml terminar, a extensão identifica a chave do arquivo e o entrega ao GFARM
              automaticamente, sem selecionar pasta nem arrastar. Somente enquanto esta janela estiver aberta.
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              A captura exige a extensão GFARM instalada e a opção “Permitir acesso a URLs de arquivo” ativada
              na página de extensões do Chrome/Edge.
              <a href="https://github.com/layon-lima/GFARM/releases/download/gfarm-captura-xml-v0.1.0/gfarm-captura-xml-chrome.zip"
                target="_blank" rel="noopener noreferrer" className="ml-1 font-semibold text-primary underline">
                Baixar extensão GFARM
              </a>
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-dashed p-3">
          <div className="text-xs font-semibold">Alternativa sem extensão</div>
          <div className={'mt-2 rounded-lg p-3 text-center ' + (arrastando ? 'bg-primary/10' : 'bg-muted/20')}
            onDragOver={event => { event.preventDefault(); setArrastando(true); }}
            onDragLeave={event => { event.preventDefault(); setArrastando(false); }}
            onDrop={event => {
              event.preventDefault(); setArrastando(false);
              importar(event.dataTransfer.files?.[0]);
            }}>
            <p className="text-xs text-muted-foreground">Arraste um XML aqui ou selecione o arquivo.</p>
            <input ref={arquivoRef} type="file" accept=".xml,application/xml,text/xml"
              className="sr-only" disabled={processando}
              onChange={event => importar(event.target.files?.[0])} />
            <Button size="sm" variant="outline" className="mt-2" disabled={processando}
              onClick={() => arquivoRef.current?.click()}>
              <FileUp className="mr-1 h-4 w-4" /> {processando ? 'Conferindo XML...' : 'Selecionar XML'}
            </Button>
          </div>
        </div>
        {resultado && (
          <div className="rounded-lg border p-3" role="status">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> XML conferido
            </div>
            <p className="mt-1 text-xs">{resultado.itens_atualizados} entrada(s) preenchida(s).</p>
            {!!resultado.nao_identificados?.length && (
              <p className="mt-2 text-xs text-amber-700">
                Confira os itens não identificados: {resultado.nao_identificados.join(', ')}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Os dados foram preenchidos, mas o estoque não foi movimentado.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
