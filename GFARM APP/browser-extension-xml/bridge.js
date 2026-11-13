// Ponte isolada: apenas a aba do GFARM pode ativar a captura de XML.
(() => {
  const ORIGIN = 'https://estoque.fazendanovohorizonte.com';
  if (location.origin !== ORIGIN || window !== window.top) return;
  // Impede listener duplicado quando o service worker injeta a ponte em aba existente.
  if (window.__GFARM_XML_BRIDGE_ATIVA__) return;
  window.__GFARM_XML_BRIDGE_ATIVA__ = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const data = event.data;
    if (data?.channel !== 'GFARM_XML_UI') return;
    if (!['START', 'STOP', 'DFE_PING', 'DFE_CERTIFICADOS', 'DFE_CONSULTAR', 'DFE_CLOSE'].includes(data.type)) return;
    const dfe = data.type.startsWith('DFE_');
    chrome.runtime.sendMessage({
      channel: 'GFARM_XML_UI', type: data.type,
      chave: data.chave, numero: data.numero, nonce: data.nonce,
      ...(dfe ? {
        thumbprint: data.thumbprint,
        interessado: data.interessado, cuf: data.cuf,
        anterior_nsu: data.anterior_nsu,
      } : {}),
    }, (response) => {
      const falhou = Boolean(chrome.runtime.lastError);
      window.postMessage({
        channel: 'GFARM_XML_EXTENSION', type: dfe ? 'DFE_RESULT' : 'STATUS',
        nonce: data.nonce, ok: !falhou && Boolean(response?.ok),
        message: falhou ? 'Extensão GFARM não respondeu ou precisa ser atualizada.'
          : response?.message || response?.reason || '',
        ...(dfe && response ? {
          cstat: response.cstat, ult_nsu: response.ult_nsu,
          max_nsu: response.max_nsu, documentos: response.documentos,
          versao: response.versao,
          certificados: response.certificados,
        } : {}),
      }, ORIGIN);
    });
  });

  chrome.runtime.onMessage.addListener((data) => {
    if (data?.channel !== 'GFARM_XML_EXTENSION') return;
    if (!['XML_DOWNLOADED', 'ERROR'].includes(data.type)) return;
    window.postMessage(data, ORIGIN);
  });
})();
