import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../ops/gfarm_control/app.js', import.meta.url),
  'utf8'
);

function createBrowser(fetch) {
  const elements = new Map();
  const buttons = [{ disabled: false }, { disabled: false }];
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        textContent: '',
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      });
    }
    return elements.get(id);
  }
  const context = {
    document: {
      addEventListener() {},
      getElementById: element,
      querySelectorAll() { return buttons; },
    },
    console: { warn() {} },
    setTimeout() {},
    fetch,
  };
  vm.runInNewContext(
    source + '\n' +
    'globalThis.testApi = { request, status };',
    context,
    { filename: 'app.js' }
  );
  return { api: context.testApi, elements, element, buttons };
}

test('Control identifica falha de rede sem atribuir erro ao GitHub', async () => {
  const browser = createBrowser(async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(
    browser.api.request('/api/action', 'POST', { action: 'update' }),
    (error) => error.network === true &&
      /Sem conexão com o GFARM Control/.test(error.message)
  );
});

test('Control não repete POST de atualização automaticamente', async () => {
  let chamadas = 0;
  const browser = createBrowser(async () => {
    chamadas += 1;
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(
    browser.api.request('/api/action', 'POST', { action: 'update' }),
    /Sem conexão/
  );
  assert.equal(chamadas, 1);
});

test('Perda de conexão durante monitoramento fica visível e impede novas ações', async () => {
  const browser = createBrowser(async () => {
    throw new TypeError('Failed to fetch');
  });
  await browser.api.status();
  assert.equal(browser.element('update-state').textContent, 'Sem conexão com o Control');
  assert.match(browser.element('notice').textContent, /Conexão.*interrompida/);
  assert.equal(browser.buttons.every((btn) => btn.disabled), true);
});
