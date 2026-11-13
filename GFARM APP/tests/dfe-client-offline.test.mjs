// Testes locais da extensao: nenhum acesso a SEFAZ, certificados ou VPS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(readFileSync(
  new URL('../browser-extension-xml/dfe-client.js', import.meta.url), 'utf-8'
), sandbox);
const dfe = sandbox.GFARM_DFE;

function resposta(status, anterior, max, count = 0) {
  const zip = gzipSync(Buffer.from('<resNFe><chNFe>' + '1'.repeat(44) + '</chNFe></resNFe>'))
    .toString('base64');
  const docs = Array.from({ length: count }, (_, i) =>
    '<docZip NSU="' + String(anterior + i + 1).padStart(15, '0') +
    '" schema="resNFe_v1.01.xsd">' + zip + '</docZip>'
  ).join('');
  return '<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">' +
    '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe">' +
    '<cStat>' + status + '</cStat>' +
    '<ultNSU>' + (anterior + count) + '</ultNSU><maxNSU>' + max + '</maxNSU>' +
    '<loteDistDFeInt>' + docs + '</loteDistDFeInt>' +
    '</retDistDFeInt></env:Envelope>';
}

test('SOAP de CPF usa CPF e ultNSU correto, sem CNPJ', () => {
  const pedido = dfe.montarEnvelope('12345678901', '21', 987);
  assert.match(pedido, /<CPF>12345678901<\/CPF>/);
  assert.doesNotMatch(pedido, /<CNPJ>/);
  assert.match(pedido, /<ultNSU>000000000000987<\/ultNSU>/);
});

test('SOAP CNPJ nao usa CPF e rejeita campos inadequados', () => {
  const pedido = dfe.montarEnvelope('12345678000199', '21', 1);
  assert.match(pedido, /<CNPJ>12345678000199<\/CNPJ>/);
  assert.throws(() => dfe.montarEnvelope('1234', '21', 1), /CPF\/CNPJ/);
  assert.throws(() => dfe.montarEnvelope('12345678901', '2X', 1), /UF/);
});

test('retorno distNSU contem 50 documentos comprimidos por lote', () => {
  const resultado = dfe.interpretarRetorno(resposta('138', 0, 120, 50), 0);
  assert.equal(resultado.cstat, '138');
  assert.equal(resultado.documentos.length, 50);
  assert.equal(resultado.ult_nsu, 50);
  assert.equal(resultado.max_nsu, 120);
  assert.equal(resultado.documentos[49].nsu, 50);
  assert.equal(resultado.documentos[0].schema_xml, 'resNFe_v1.01.xsd');
});

test('137 e 656 retornam sem documentos para respeitar pausa de consultas', () => {
  for (const status of ['137', '656']) {
    const resultado = dfe.interpretarRetorno(resposta(status, 123, 123, 0), 123);
    assert.equal(resultado.cstat, status);
    assert.equal(resultado.documentos.length, 0);
  }
});

test('erro fiscal, XML malicioso e lote excessivo nao passam pelo parser', () => {
  assert.throws(() => dfe.interpretarRetorno(resposta('472', 0, 0), 0), /472/);
  assert.throws(() => dfe.interpretarRetorno('<!DOCTYPE x>' + resposta('137', 0, 0), 0),
    /entidade proibida/);
  assert.throws(() => dfe.interpretarRetorno(resposta('138', 0, 100, 51), 0),
    /limite seguro/);
});
