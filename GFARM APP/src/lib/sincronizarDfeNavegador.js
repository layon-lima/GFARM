/**
 * Chama a extensao GFARM: a ponte local do Windows lista certificados publicos
 * e faz TLS com o certificado escolhido, sem exportar a chave privada.
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
          ? 'Extensao GFARM nao respondeu. Ative a versao 0.3.0, permita acesso ao site GFARM e recarregue a aba no Edge/Chrome.'
          : 'A consulta nao respondeu. Confira o certificado e a conexao.'
      ));
    }, timeoutMs);
    window.postMessage({
      channel: 'GFARM_XML_UI', type: comando, nonce,
      ...campos,
    }, origem);
  });
}
