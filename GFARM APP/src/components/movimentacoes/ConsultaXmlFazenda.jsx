import { useEffect, useRef } from 'react';

const ORIGIN = 'https://estoque.fazendanovohorizonte.com';
const MAX_XML_BYTES = 3 * 1024 * 1024;

/**
 * Captura invisivel: a extensao do navegador informa quando o XML da NF-e
 * selecionada termina de baixar. Nao mostra modal, formulario ou seletor.
 * O servidor continua conferindo chave, numero e itens antes de atualizar
 * as pendencias. Nenhum item e aprovado automaticamente.
 */
export default function ConsultaXmlFazenda({
  nota, onImportar, onStatus, onConcluido, onErro,
}) {
  const nonceRef = useRef(crypto.randomUUID());
  const importarRef = useRef(onImportar);
  const statusRef = useRef(onStatus);
  const concluidoRef = useRef(onConcluido);
  const erroRef = useRef(onErro);
  const processandoRef = useRef(false);

  importarRef.current = onImportar;
  statusRef.current = onStatus;
  concluidoRef.current = onConcluido;
  erroRef.current = onErro;

  useEffect(() => {
    const nonce = nonceRef.current;
    const chave = String(nota.chave_acesso || '').replace(/\D/g, '');
    let ativo = true;
    let statusRecebido = false;

    function status(ok, mensagem) {
      if (!ativo || statusRecebido) return;
      statusRecebido = true;
      statusRef.current?.(ok, mensagem);
    }

    async function receber(event) {
      if (!ativo || event.source !== window || event.origin !== ORIGIN) return;
      const dados = event.data;
      if (dados?.channel !== 'GFARM_XML_EXTENSION' || dados.nonce !== nonce) return;

      if (dados.type === 'STATUS') {
        status(Boolean(dados.ok), dados.message || '');
        return;
      }
      if (dados.type === 'ERROR') {
        erroRef.current?.(dados.message || 'Falha ao ler o XML baixado.');
        return;
      }
      if (dados.type !== 'XML_DOWNLOADED' || dados.chave !== chave ||
          !dados.base64 || processandoRef.current) return;

      processandoRef.current = true;
      try {
        const binario = atob(dados.base64);
        if (binario.length > MAX_XML_BYTES || binario.length < 60) {
          throw new Error('XML fora do limite permitido de 3 MB.');
        }
        const bytes = Uint8Array.from(binario, caractere => caractere.charCodeAt(0));
        const arquivo = new File(
          [bytes], dados.arquivo || 'nota.xml',
          { type: 'application/xml' },
        );
        const retorno = await importarRef.current?.(arquivo);
        if (retorno && ativo) concluidoRef.current?.(retorno);
      } catch (erro) {
        if (ativo) erroRef.current?.(erro.message || 'Não foi possível importar o XML.');
      } finally {
        processandoRef.current = false;
      }
    }

    window.addEventListener('message', receber);
    window.postMessage({
      channel: 'GFARM_XML_UI',
      type: 'START',
      chave,
      numero: String(nota.numero_nota || ''),
      nonce,
    }, ORIGIN);

    const timeout = setTimeout(() => {
      status(false, 'Extensão GFARM não detectada. É necessário instalá-la e permitir o acesso a arquivos.');
    }, 2400);

    return () => {
      ativo = false;
      clearTimeout(timeout);
      window.postMessage({ channel: 'GFARM_XML_UI', type: 'STOP', nonce }, ORIGIN);
      window.removeEventListener('message', receber);
    };
  }, [nota.chave_acesso, nota.numero_nota]);

  return null;
}
