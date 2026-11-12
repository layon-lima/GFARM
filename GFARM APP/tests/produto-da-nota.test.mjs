import test from 'node:test';
import assert from 'node:assert/strict';

import { montarProdutoDaNota } from '../src/lib/produtoDaNota.js';

const produtos = [{ id: 'p1', codigo: 'P0001', nome: 'Antigo', setor_id: 'S1' }];
const depositos = [{ id: 'D1', setor_id: 'S1' }, { id: 'D2', setor_id: 'S2' }];
const gavetas = [{ id: 'G1', deposito_id: 'D1' }];

const nota = (unidade) => ({
  produto: 'Welden',
  codigo_produto: 'COD-FORNECEDOR-58',
  quantidade: '195',
  unidade,
  valor_unitario: '3.21',
  chave_acesso: '1'.repeat(44),
  ncm: '3808',
  cfop: '5102',
  validade: '2028-01-01',
});

const formulario = (unidade, extras = {}) => ({
  nome: 'Welden',
  codigo_referencia: 'COD-FORNECEDOR-58',
  unidade,
  setor_id: 'S1',
  deposito_id: 'D1',
  gaveta_id: 'G1',
  fator_conversao: '',
  ...extras,
});

test('cadastra nome e referência da NF-e, sem criar quantidade, lote ou custo de estoque', () => {
  const result = montarProdutoDaNota(nota('L'), formulario('L'), produtos, depositos, gavetas);
  assert.equal(result.nome, 'Welden');
  assert.equal(result.codigo_referencia, 'COD-FORNECEDOR-58');
  assert.equal(result.codigo, 'P0002');
  assert.equal(result.unidade, 'L');
  assert.equal(result.unidade_alt, null);
  assert.equal(result.fator_conversao, 0);
  assert.equal(result.custo_unitario, 0);
  assert.ok(!('quantidade' in result));
  assert.ok(!('cfop' in result));
  assert.ok(!('ncm' in result));
  assert.ok(!('data_validade' in result));
});

test('custo médio inicial é opcional e fica separado da NF-e', () => {
  const semPreco = { ...nota('L'), valor_unitario: null };
  const vazio = montarProdutoDaNota(semPreco, formulario('L'), produtos, depositos, gavetas);
  assert.equal(vazio.custo_unitario, 0);
  assert.ok(!('quantidade' in vazio));
  const cadastrado = montarProdutoDaNota(
    semPreco, formulario('L', { custo_unitario: '7,65' }), produtos, depositos, gavetas,
  );
  assert.equal(cadastrado.custo_unitario, 7.65);
  assert.ok(!('quantidade' in cadastrado));
  assert.ok(!('valor_total' in cadastrado));
  const comPonto = montarProdutoDaNota(
    nota('kg'), formulario('kg', { custo_unitario: '0.000325' }),
    produtos, depositos, gavetas,
  );
  assert.equal(comPonto.custo_unitario, 0.000325);
});

test('preço fiscal da nota não é assumido automaticamente como custo inicial', () => {
  const notaComPreco = { ...nota('L'), valor_unitario: '999.50' };
  assert.equal(montarProdutoDaNota(
    notaComPreco, formulario('L'), produtos, depositos, gavetas,
  ).custo_unitario, 0);
});

test('custo médio inválido não pode entrar no cadastro', () => {
  for (const custo of ['-2', 'NaN', 'Infinity', '12,34,56', '1.000,25', 'abc']) {
    assert.throws(
      () => montarProdutoDaNota(
        nota('L'), formulario('L', { custo_unitario: custo }), produtos, depositos, gavetas,
      ), /Custo médio inválido/,
    );
  }
});

test('LT como unidade da nota aceita L com fator 1 no motor', () => {
  const result = montarProdutoDaNota(nota('LT'), formulario('L'), produtos, depositos, gavetas);
  assert.equal(result.unidade_alt, 'LT');
  assert.equal(result.fator_conversao, 1);
});

test('T como unidade da nota aceita kg com fator 1000 no motor', () => {
  const result = montarProdutoDaNota(nota('T'), formulario('kg'), produtos, depositos, gavetas);
  assert.equal(result.unidade_alt, 'T');
  assert.equal(result.fator_conversao, 1000);
});

test('caixa exige informar quantidade por embalagem', () => {
  assert.throws(() => montarProdutoDaNota(nota('CX'), formulario('kg'), produtos, depositos, gavetas),
    /Informe quantas unidades/);
  const result = montarProdutoDaNota(nota('CX'), formulario('kg', { fator_conversao: '20' }), produtos, depositos, gavetas);
  assert.equal(result.unidade_alt, 'CX');
  assert.equal(result.fator_conversao, 20);
});

test('rejeita endereço inválido, para não gravar produto com depósito de outro setor', () => {
  assert.throws(() => montarProdutoDaNota(nota('kg'), formulario('kg', { deposito_id: 'D2' }), produtos, depositos, gavetas),
    /Depósito não pertence/);
  assert.throws(() => montarProdutoDaNota(nota('kg'), formulario('kg', { gaveta_id: 'G2' }), produtos, depositos, gavetas),
    /Gaveta não pertence/);
});
