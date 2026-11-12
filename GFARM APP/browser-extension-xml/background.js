// Chrome/Edge MV3: somente XML novo e com a chave da NF-e selecionada.
const GFARM = 'https://estoque.fazendanovohorizonte.com';
const MAX_BYTES = 3 * 1024 * 1024;
const SESSION_TTL_MS = 45 * 60 * 1000;

function digits(v) { return String(v || '').replace(/\D/g, ''); }
function normalizeNumber(v) { return String(v || '').replace(/^0+/, '') || '0'; }

async function sessions() {
  const { ativos } = await chrome.storage.session.get({ ativos: {} });
  return ativos || {};
}
async function setSessions(ativos) {
  await chrome.storage.session.set({ ativos });
}
async function relay(tabId, payload) {
  try { await chrome.tabs.sendMessage(Number(tabId), {
    channel: 'GFARM_XML_EXTENSION', ...payload,
  }); } catch { /* Aba do GFARM fechada; evento ignorado. */ }
}
async function handleBridge(message, sender) {
  const url = new URL(sender.url || sender.tab?.url || 'https://invalid.local/');
  if (url.origin !== GFARM || !sender.tab?.id) return { ok: false };
  const tab = String(sender.tab.id);
  const current = await sessions();
  if (message.type === 'START') {
    const chave = digits(message.chave);
    if (!/^\d{44}$/.test(chave) || !/^[a-zA-Z0-9-]{10,100}$/.test(String(message.nonce || ''))) {
      return { ok: false, reason: 'Chave ou sessão inválida.' };
    }
    const fileAccess = await chrome.extension.isAllowedFileSchemeAccess();
    if (!fileAccess) return { ok: false, reason:
      'Ative "Permitir acesso a URLs de arquivo" em chrome://extensions para a extensão GFARM.' };
    current[tab] = {
      chave, numero: String(message.numero || '').trim(),
      nonce: message.nonce, startedAt: Date.now(),
    };
    await setSessions(current);
    return { ok: true, reason: 'Captura automática do navegador ativada.' };
  }
  if (message.type === 'STOP') {
    if (current[tab]?.nonce === message.nonce) {
      delete current[tab]; await setSessions(current);
    }
    return { ok: true };
  }
  return { ok: false };
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.channel === 'GFARM_XML_UI') {
    handleBridge(msg, sender).then(respond).catch(() => respond({ ok: false, reason: 'Falha na extensão.' }));
    return true;
  }
  if (msg?.channel === 'GFARM_FSIST_PREFILL') {
    try {
      const url = new URL(sender.url || sender.tab?.url || 'https://invalid.local/');
      if (!['www.fsist.com.br','chaves.fsist.com.br'].includes(url.hostname)) return;
    } catch { return; }
    sessions().then(ativos => {
      const valida = Object.values(ativos).find(s => Date.now() - s.startedAt < SESSION_TTL_MS);
      respond({ chave: valida?.chave || '' });
    }).catch(() => respond({ chave: '' }));
    return true;
  }
});
chrome.tabs.onRemoved.addListener(async id => {
  const ativos = await sessions();
  if (ativos[String(id)]) {
    delete ativos[String(id)];
    await setSessions(ativos);
  }
});

function fileURL(path) {
  const p = String(path || '').replace(/\\/g, '/');
  if (p.startsWith('//') || !(/^[A-Za-z]:\//.test(p) || p.startsWith('/'))) {
    throw new Error('Caminho do download não suportado.');
  }
  // Não montar URL com nome recebido do site: sempre usar nome retornado
  // pelo próprio chrome.downloads após o download terminar.
  const segments = p.split('/').map((part, index) =>
    index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)
  ).join('/');
  return /^[A-Za-z]:\//.test(p) ? 'file:///' + segments : 'file://' + segments;
}
function toBase64(bytes) {
  let binary = '';
  for (let pos = 0; pos < bytes.length; pos += 8192) {
    binary += String.fromCharCode(...bytes.subarray(pos, pos + 8192));
  }
  return btoa(binary);
}
function identifyXML(bytes) {
  const text = new TextDecoder('utf-8').decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return null;
  const chave = /<(?:[A-Za-z_][\w.-]*:)?infNFe\b[^>]*\bId\s*=\s*["']NFe(\d{44})["']/i.exec(text)?.[1]
    || /<(?:[A-Za-z_][\w.-]*:)?chNFe>\s*(\d{44})\s*<\//i.exec(text)?.[1] || '';
  const numero = /<(?:[A-Za-z_][\w.-]*:)?nNF>\s*(\d+)\s*<\//i.exec(text)?.[1] || '';
  return chave && numero ? { chave, numero } : null;
}

chrome.downloads.onChanged.addListener(async delta => {
  if (delta.state?.current !== 'complete') return;
  const ativos = await sessions();
  const emUso = Object.entries(ativos).filter(([, s]) =>
    s && Date.now() - s.startedAt < SESSION_TTL_MS
  );
  if (!emUso.length) return;
  let item;
  try { item = (await chrome.downloads.search({ id: delta.id }))[0]; } catch { return; }
  if (!item || item.state !== 'complete' || !/\.xml$/i.test(item.filename || '')
      || (item.fileSize >= 0 && item.fileSize > MAX_BYTES)) return;
  const iniciado = new Date(item.startTime || 0).getTime();
  const possiveis = emUso.filter(([, s]) => iniciado >= s.startedAt - 10000);
  if (!possiveis.length) return;
  try {
    const response = await fetch(fileURL(item.filename), { cache: 'no-store' });
    if (!response.ok) throw new Error('Leitura do arquivo negada pelo navegador.');
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length < 60 || data.length > MAX_BYTES) return;
    const info = identifyXML(data);
    if (!info) return;
    const base64 = toBase64(data);
    for (const [tab, s] of possiveis) {
      if (s.chave !== info.chave || normalizeNumber(s.numero) !== normalizeNumber(info.numero)) continue;
      await relay(tab, {
        type: 'XML_DOWNLOADED', nonce: s.nonce, chave: s.chave,
        arquivo: String(item.filename).split(/[\\/]/).pop(), base64,
      });
    }
  } catch (err) {
    for (const [tab, s] of possiveis) {
      await relay(tab, { type: 'ERROR', nonce: s.nonce, message:
        'O download foi detectado, mas não pôde ser lido. Verifique a permissão de acesso a arquivos da extensão.'
      });
    }
  }
});
