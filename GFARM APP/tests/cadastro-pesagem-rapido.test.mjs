import assert from 'node:assert/strict';
import test from 'node:test';
import {
  camposNovoPerfil,
  localizarPessoaExistente,
  localizarVeiculoExistente,
  normalizarDocumento,
  normalizarNome,
  normalizarPlaca,
} from '../src/lib/cadastroPesagemRapido.js';

test('compara nomes ignorando espacos, caixa e acentos', () => {
  assert.equal(normalizarNome('  João  da Silva  '), 'JOAO DA SILVA');
});

test('cpf e cnpj são comparados sem pontuação', () => {
  assert.equal(normalizarDocumento('123.456.789-00'), '12345678900');
  const pessoas = [{ id: '1', nome: 'Transportes Exemplo', documento: '12.345.678/0001-90' }];
  assert.equal(localizarPessoaExistente(pessoas, 'Outra Razão Social', '12345678000190')[0].id, '1');
});

test('pessoa que já existe é localizada antes de tentar outro cadastro', () => {
  const pessoas = [{ id: 'p1', nome: 'JOÃO DA SILVA', documento: '' }];
  assert.equal(localizarPessoaExistente(pessoas, ' Joao da Silva ', '').length, 1);
  assert.equal(localizarPessoaExistente(pessoas, 'Maria', '').length, 0);
});

test('homônimos com CPF/CNPJ diferentes não são o mesmo cadastro', () => {
  const pessoas = [{ id: '1', nome: 'João', documento: '111.111.111-11' }];
  assert.equal(localizarPessoaExistente(pessoas, 'JOÃO', '222.222.222-22').length, 0);
});

test('placa já existente é reconhecida mesmo com máscara', () => {
  const veiculos = [{ id: 'v1', placa: 'ABC-1D23' }];
  assert.equal(normalizarPlaca('abc-1d23'), 'ABC1D23');
  assert.equal(localizarVeiculoExistente(veiculos, 'abc1d23').id, 'v1');
});

test('motorista criado não ganha perfil de cliente por padrão', () => {
  const dados = camposNovoPerfil('is_motorista', { nome: 'Motorista 1', cnh: '123' });
  assert.equal(dados.is_motorista, true);
  assert.equal(dados.is_cliente, false);
  assert.equal(dados.is_transportadora, false);
  assert.equal(dados.is_fornecedor, false);
  assert.equal(dados.cnh, '123');
});

test('não aceita perfis fora do cadastro oficial', () => {
  assert.throws(() => camposNovoPerfil('is_admin', { nome: 'Teste' }), /Perfil não permitido/);
});
