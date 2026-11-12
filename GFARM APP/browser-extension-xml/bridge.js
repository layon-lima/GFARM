// Ponte isolada: apenas a aba do GFARM pode ativar a captura de XML.
(() => {
  const ORIGIN = 'https://estoque.fazendanovohorizonte.com';
  if (location.origin !== ORIGIN || window !== window.top) return;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const data = event.data;
    if (data?.channel !== 'GFARM_XML_UI') return;
    if (!['START', 'STOP'].includes(data.type)) return;
    chrome.runtime.sendMessage({
      channel: 'GFARM_XML_UI', type: data.type,
      chave: data.chave, numero: data.numero, nonce: data.nonce,
    }, (response) => {
      if (chrome.runtime.lastError) {
        window.postMessage({
          channel: 'GFARM_XML_EXTENSION', type: 'STATUS', nonce: data.nonce,
          ok: false, message: 'Extensão GFARM não respondeu.',
        }, ORIGIN);
        return;
      }
      window.postMessage({
        channel: 'GFARM_XML_EXTENSION', type: 'STATUS', nonce: data.nonce,
        ok: Boolean(response?.ok), message: response?.reason || '',
      }, ORIGIN);
    });
  });

  chrome.runtime.onMessage.addListener((data) => {
    if (data?.channel !== 'GFARM_XML_EXTENSION') return;
    if (!['XML_DOWNLOADED', 'ERROR'].includes(data.type)) return;
    window.postMessage(data, ORIGIN);
  });
})();
