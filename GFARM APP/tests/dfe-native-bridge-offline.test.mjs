import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const get = p => fs.readFileSync(new URL(p, root), 'utf8');
const manifest = JSON.parse(get('browser-extension-xml/manifest.json'));

test('extensao v0.3 declara host nativo, scripting e GFARM como origem', () => {
  assert.equal(manifest.version, '0.3.0');
  assert.ok(manifest.permissions.includes('nativeMessaging'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.host_permissions.some(p => p.includes('estoque.fazendanovohorizonte.com')));
});

test('detectar extensao e listar certificados antes da consulta', () => {
  const bg = get('browser-extension-xml/background.js');
  const bridge = get('browser-extension-xml/bridge.js');
  const page = get('src/pages/RecebimentosPendentes.jsx');
  assert.match(bg, /chrome\.runtime\.connectNative\(NATIVE_HOST\)/);
  assert.match(bg, /chrome\.scripting\.executeScript/);
  assert.match(bridge, /DFE_CERTIFICADOS/);
  assert.match(page, /escolherCertificadoDfe/);
  assert.match(page, /certificadosDfe\.map/);
  assert.doesNotMatch(page, /window\.prompt\(\s*['"]CPF/);
  assert.match(page, /thumbprint, interessado, cuf, anterior_nsu/);
});

test('ponte Windows usa mTLS, certificacao instalada e destino fixo SEFAZ', () => {
  const host = get('browser-extension-xml/native-host/NativeHost.cs');
  assert.match(host, /X509Store\(StoreName\.My, location\)/);
  assert.match(host, /ClientCertificateOptions = ClientCertificateOption\.Manual/);
  assert.match(host, /ClientCertificates\.Add\(escolhido\)/);
  assert.match(host, /NFeDistribuicaoDFe\.asmx/);
  assert.doesNotMatch(host, /Export\(/);
  assert.match(host, /DtdProcessing\.Prohibit/);
});
