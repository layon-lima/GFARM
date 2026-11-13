// Uma pagina REAL do Chrome/Edge (WebContents) permite mostrar o seletor
// nativo de certificados TLS. Fetch de SW sem WebContents pode nao mostrar.
(() => {
  'use strict';
  const id = new URLSearchParams(location.search).get('job') || '';
  const estado = document.getElementById('estado');
  let ocupado = false;
  function mostrar(valor) { estado.textContent = valor; }

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.channel !== 'GFARM_DFE_EXEC') return;
    if (ocupado) {
      respond({ ok: false, reason: 'Consulta anterior ainda em andamento.' });
      return;
    }
    ocupado = true;
    mostrar('Consultando a SEFAZ pelo navegador. Escolha o certificado do titular quando solicitado...');
    globalThis.GFARM_DFE.consultar(
      String(msg.interessado || ''), String(msg.cuf || ''), Number(msg.anterior_nsu)
    ).then(resultado => {
      mostrar('Lote recebido da SEFAZ. Enviando XMLs para conferencia no GFARM...');
      respond({ ok: true, ...resultado });
    }).catch(error => {
      mostrar('Falha de consulta: ' + (error.message || 'Verifique o certificado.'));
      respond({ ok: false, reason: error.message || 'Falha no certificado da SEFAZ.' });
    }).finally(() => {
      ocupado = false;
    });
    return true;
  });

  if (/^[0-9a-f-]{36}$/i.test(id)) {
    chrome.runtime.sendMessage({ channel: 'GFARM_DFE_POPUP', type: 'READY', job: id })
      .catch(() => mostrar('Nao foi possivel estabelecer comunicacao com a extensao.'));
  } else {
    mostrar('Janela sem identificacao de sessao. Feche e inicie novamente pelo GFARM.');
  }
})();
