import test from 'node:test';
import assert from 'node:assert/strict';
import { precoFiscalNaUnidadeBase, precoFiscalParaInput, fatorParaUnidadeBase } from '../src/lib/custoRecebimentoNfe.js';

const nota = {
  numero_nota: '177324', quantidade: '195.000', unidade: 'L',
  valor_unitario: '120', valor_total: '23400',
};
const produto = { id: 'p1', unidade: 'L', unidade_alt: null, fator_conversao: 0 };

test('valor total fiscal deve prevalecer e preencher custo na mesma unidade da nota', () => {
  assert.equal(precoFiscalNaUnidadeBase(nota, produto), 120);
  assert.equal(precoFiscalParaInput(precoFiscalNaUnidadeBase(nota, produto)), '120');
});
test('valor unitário da nota é usado quando total não existe', () => {
  assert.equal(precoFiscalNaUnidadeBase({ quantidade: '4', unidade: 'L', valor_unitario: '25' }, produto), 25);
});
test('converter T para kg pelo cadastro do produto, sem multiplicar o preço', () => {
  const nfe = { quantidade: '4', unidade: 'T', valor_total: '24000' };
  const cadastrado = { unidade: 'kg', unidade_alt: 'T', fator_conversao: 1000 };
  assert.equal(fatorParaUnidadeBase(nfe, cadastrado), 1000);
  assert.equal(precoFiscalNaUnidadeBase(nfe, cadastrado), 6);
});
test('conversão de CX para kg pode usar fator informado no formulário', () => {
  const nfe = { quantidade: '10', unidade: 'CX', valor_unitario: '350' };
  const cadastrado = { unidade: 'kg', unidade_alt: 'CX', fator_conversao: 25 };
  assert.equal(precoFiscalNaUnidadeBase(nfe, cadastrado), 14);
  assert.equal(precoFiscalNaUnidadeBase(nfe, cadastrado, '50'), 7);
});
test('custo zero da nota é válido; preço ausente não equivale a zero', () => {
  assert.equal(precoFiscalNaUnidadeBase({ quantidade: '5', unidade: 'L', valor_total: '0' }, produto), 0);
  assert.equal(precoFiscalNaUnidadeBase({ quantidade: '5', unidade: 'L' }, produto), null);
});
test('incompatibilidade de unidade nunca gera custo presumido', () => {
  assert.equal(precoFiscalNaUnidadeBase({ quantidade: '5', unidade: 'CX', valor_total: '100' }, produto), null);
});
test('campos vazios ou inválidos não produzem custo unitário', () => {
  assert.equal(precoFiscalNaUnidadeBase({ quantidade: '0', unidade: 'L', valor_total: '100' }, produto), null);
  assert.equal(precoFiscalNaUnidadeBase({ quantidade: '5', unidade: 'L', valor_unitario: 'NaN' }, produto), null);
});
