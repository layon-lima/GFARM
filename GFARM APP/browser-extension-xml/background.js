// Chrome/Edge MV3: somente XML novo e com a chave da NF-e selecionada.
// A consulta por certificado roda em pagina visivel da extensao, nao no SW.
// Sem WebContents o Chrome pode cancelar o seletor nativo de certificados.
const GFARM = 'https://estoque.fazendanovohorizonte.com';

const NATIVE_HOST = 'com.gfarm.certificados';

// Um host Windows autorizado pela extensao lista certificados PUBLICOS e faz
// TLS usando a chave protegida no repositorio Windows (sem exportacao PFX).
function chamarPonteWindows(pedido, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const pedacos = [];
    let completo = false;
    let porta;
    let timer;
    const finalizar = (error, result) => {
      if (completo) return;
      completo = true;
      clearTimeout(timer);
      try { porta?.disconnect(); } catch { /* processo ja saiu */ }
      if (error) reject(error); else resolve(result);
    };
    try { porta = chrome.runtime.connectNative(NATIVE_HOST); }
    catch {
      reject(new Error('Ponte de certificados Windows indisponivel. Instale a ponte GFARM v0.3.0.'));
      return;
    }
    porta.onMessage.addListener(msg => {
      if (msg?.type === 'result') {
        finalizar(null, msg.value);
      } else if (msg?.type === 'chunk') {
        pedacos.push(String(msg.data || ''));
        if (pedacos.length > 150 || pedacos.join('').length > 22000000) {
          finalizar(new Error('Resposta da ponte ultrapassou o limite.'));
        }
      } else if (msg?.type === 'done') {
        try { finalizar(null, JSON.parse(pedacos.join(''))); }
        catch { finalizar(new Error('Resposta da ponte Windows invalida.')); }
      }
    });
    porta.onDisconnect.addListener(() => {
      if (completo) return;
      const erro = chrome.runtime.lastError?.message || '';
      const ausente = /native messaging host not found|specified native messaging host|access to the specified native messaging/i.test(erro);
      finalizar(new Error(ausente
        ? 'Ponte de certificados Windows nao instalada/autorizada. Instale a ponte GFARM v0.3.0.'
        : 'Falha na ponte Windows: ' + (erro || 'processo encerrado.')));
    });
    timer = setTimeout(() => finalizar(new Error('A ponte Windows nao respondeu no prazo.')), timeoutMs);
    porta.postMessage(pedido);
  });
}

const MAX_BYTES = 3 * 1024 * 1024;
const SESSION_TTL_MS = 45 * 60 * 1000;

const aguardandoJanelaDfe = new Map();
let consultaDfeEmAndamento = false;

async function obterJanelaDfe() {
  const { dfeJanela } = await chrome.storage.session.get({ dfeJanela: null });
  if (dfeJanela?.id) {
    try {
      await chrome.windows.get(dfeJanela.id);
      await chrome.windows.update(dfeJanela.id, { focused: true });
      return dfeJanela;
    } catch { /* Janela fechada: criamos outra abaixo. */ }
  }
  const job = crypto.randomUUID();
  let resolvePronta;
  let rejectPronta;
  const pronta = new Promise((resolve, reject) => {
    resolvePronta = resolve;
    rejectPronta = reject;
  });
  const timer = setTimeout(() => {
    aguardandoJanelaDfe.delete(job);
    rejectPronta(new Error('Janela de certificado nao abriu no navegador.'));
  }, 12000);
  aguardandoJanelaDfe.set(job, () => {
    clearTimeout(timer);
    aguardandoJanelaDfe.delete(job);
    resolvePronta();
  });
  let janela;
  try {
    janela = await chrome.windows.create({
      url: chrome.runtime.getURL('dfe-sync.html?job=' + job),
      type: 'popup', focused: true, width: 520, height: 285,
    });
    await pronta;
    const estado = { id: janela.id };
    await chrome.storage.session.set({ dfeJanela: estado });
    return estado;
  } catch (error) {
    clearTimeout(timer);
    aguardandoJanelaDfe.delete(job);
    if (janela?.id) await chrome.windows.remove(janela.id).catch(() => {});
    throw error;
  }
}
async function consultarDfeNaJanela(interessado, cuf, anterior_nsu) {
  if (consultaDfeEmAndamento) throw Error('Outra consulta fiscal ainda esta em andamento.');
  consultaDfeEmAndamento = true;
  try {
    await obterJanelaDfe();
    // A janela tem WebContents e pode abrir o seletor de certificados.
    return await chrome.runtime.sendMessage({
      channel: 'GFARM_DFE_EXEC', interessado, cuf, anterior_nsu,
    });
  } finally {
    consultaDfeEmAndamento = false;
  }
}
async function fecharJanelaDfe() {
  const { dfeJanela } = await chrome.storage.session.get({ dfeJanela: null });
  await chrome.storage.session.remove('dfeJanela');
  if (dfeJanela?.id) {
    await chrome.windows.remove(dfeJanela.id).catch(() => {});
  }
}
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
  if (message.type === 'DFE_PING') {
    return { ok: true, versao: '0.3.0', dfe: true, certificadosWindows: true };
  }
  if (message.type === 'DFE_CERTIFICADOS') {
    try { return await chamarPonteWindows({ op: 'LISTAR' }, 30000); }
    catch (erro) { return { ok: false, reason: erro.message }; }
  }
  if (message.type === 'DFE_CLOSE') {
    await fecharJanelaDfe();
    return { ok: true };
  }
  if (message.type === 'DFE_CONSULTAR') {
    const thumbprint = String(message.thumbprint || '').toUpperCase();
    const interessado = String(message.interessado || '');
    const cuf = String(message.cuf || '');
    const anterior = Number(message.anterior_nsu);
    if (!/^[A-F0-9]{40}$/.test(thumbprint)
      || !/^(?:\d{11}|\d{14})$/.test(interessado)
      || !/^\d{2}$/.test(cuf)
      || !Number.isSafeInteger(anterior) || anterior < 0) {
      return { ok: false, reason: 'CPF/CNPJ, UF ou NSU invalido.' };
    }
    const key = 'dfe_cooldown_' + interessado;
    const now = Date.now();
    const stored = await chrome.storage.local.get(key);
    const pause = Number(stored[key] || 0);
    if (pause > now) {
      return { ok: false, reason: 'A consulta deste CPF/CNPJ esta em intervalo da SEFAZ. Tente mais tarde.' };
    }
    try {
      const result = await chamarPonteWindows({ op: 'CONSULTAR', thumbprint, interessado, cuf, anterior_nsu: anterior });
      if (!result?.ok) {
        throw new Error(result?.message || result?.reason || 'A ponte nao conseguiu consultar a SEFAZ.');
      }
      let pauseMs = 0;
      if (result.cstat === '656') pauseMs = 125 * 60 * 1000;
      else if (result.cstat === '137' || result.ult_nsu >= result.max_nsu) {
        pauseMs = 65 * 60 * 1000;
      }
      if (pauseMs) {
        await chrome.storage.local.set({ [key]: Date.now() + pauseMs });
      }
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, reason: error.message || 'Erro na consulta fiscal.' };
    }
  }
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
  if (msg?.channel === 'GFARM_DFE_POPUP' && msg.type === 'READY'
      && sender.url?.startsWith(chrome.runtime.getURL('dfe-sync.html'))) {
    const pronto = aguardandoJanelaDfe.get(msg.job);
    if (pronto) pronto();
    respond({ ok: Boolean(pronto) });
    return;
  }
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


// Inserir a ponte em abas GFARM que ja estavam abertas quando a extensao foi
// habilitada/atualizada. A ponte e idempotente, e novas paginas tambem usam o
// content_script declarado no manifest.
async function injetarPonte(tab) {
  if (!Number.isInteger(tab?.id) || !String(tab.url || '').startsWith(GFARM + '/')) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridge.js'] });
  } catch { /* Aba protegida, carregando ou permissao do site desativada. */ }
}
async function conectarAbasAbertas() {
  const tabs = await chrome.tabs.query({ url: GFARM + '/*' }).catch(() => []);
  await Promise.all(tabs.map(injetarPonte));
}
chrome.runtime.onInstalled.addListener(() => { conectarAbasAbertas(); });
chrome.runtime.onStartup.addListener(() => { conectarAbasAbertas(); });
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) injetarPonte(tab);
});
chrome.tabs.onUpdated.addListener((_id, changes, tab) => {
  if (changes.status === 'complete') injetarPonte(tab);
});
