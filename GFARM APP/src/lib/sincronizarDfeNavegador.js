/**
 * Chama a extensao GFARM do Chrome/Edge: usa certificado TLS escolhido pelo
 * navegador, mas NUNCA le/exporta chaves privadas do repositorio Windows.
 */
export function consultarExtensaoDfe(comando, campos = {}, timeoutMs = 120000) {
  const origem = window.location.origin;
  const nonce = window.crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let timer;
    const receber = event => {
      const msg = event.data;
      if (event.source !== window || event.origin !== origem ||
          msg?.channel !== 'GFARM_XML_EXTENSION' ||
          msg?.type !== 'DFE_RESULT' || msg?.nonce !== nonce) return;
      clearTimeout(timer);
      window.removeEventListener('message', receber);
      resolve(msg);
    };
    window.addEventListener('message', receber);
    timer = setTimeout(() => {
      window.removeEventListener('message', receber);
      reject(new Error(
        comando === 'DFE_PING'
          ? 'Extensao GFARM v0.2.0 nao encontrada. Atualize a extensao no Chrome/Edge.'
          : 'A consulta nao respondeu. Confira o certificado e a conexao.'
      ));
    }, timeoutMs);
    window.postMessage({
      channel: 'GFARM_XML_UI', type: comando, nonce,
      ...campos,
    }, origem);
  });
}
