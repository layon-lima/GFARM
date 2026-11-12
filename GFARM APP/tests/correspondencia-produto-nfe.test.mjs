import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarNomeProduto,
  encontrarProdutoExatoDaNota,
  sugerirProdutosDaNota,
} from '../src/lib/correspondenciaProdutoNfe.js';

const produtos = [
  { id: 'v1', nome: 'VIANCE', codigo: 'P0007', codigo_referencia: 'F-007', setor_id: 's1', unidade: 'L' },
  { id: 'z1', nome: 'ZAFERA WG', codigo: 'P0008', codigo_referencia: 'ZAF001', setor_id: 's1', unidade: 'kg' },
  { id: 'w1', nome: 'WELDEN 5 L', codigo: 'P0009', codigo_referencia: 'W5', setor_id: 's1', unidade: 'L' },
  { id: 'w2', nome: 'WELDEN SC', codigo: 'P0010', codigo_referencia: 'WS', setor_id: 's1', unidade: 'L' },
];
const nota = (nome, unidade='L', codigo='') => ({
  produto: nome, unidade, codigo_produto: codigo,
});

test('Viance identifica automaticamente produto cadastrado VIANCE, ignorando maiúsculas', () => {
  assert.equal(encontrarProdutoExatoDaNota(nota('Viance'), produtos)?.id, 'v1');
  assert.equal(normalizarNomeProduto('Záfera-wg'), 'ZAFERA WG');
});

test('código do fornecedor pode ajudar na pesquisa, sem sobrepor nome divergente automaticamente', () => {
  assert.equal(encontrarProdutoExatoDaNota(nota('NOVO PRODUTO','L','F-007'), produtos), null);
  const matches=sugerirProdutosDaNota(nota('NOVO PRODUTO','L','F-007'), produtos);
  assert.equal(matches[0]?.produto.id, 'v1');
});

test('repetição do mesmo nome em setores diferentes impede associação automática', () => {
  const duplicados=[...produtos, { ...produtos[0], id: 'v2', setor_id: 's2' }];
  assert.equal(encontrarProdutoExatoDaNota(nota('Viance'), duplicados), null);
  assert.equal(sugerirProdutosDaNota(nota('Viance'), duplicados).filter(x=>x.produto.nome==='VIANCE').length,2);
});

test('nomes comerciais semelhantes geram sugestões, não produto automático', () => {
  assert.equal(encontrarProdutoExatoDaNota(nota('Welden'), produtos), null);
  const lista=sugerirProdutosDaNota(nota('Welden'), produtos);
  assert.equal(lista[0]?.produto.id,'w1');
  assert.equal(lista[1]?.produto.id,'w2');
});

test('campo pesquisável encontra nomes já com 2 letras e códigos parciais', () => {
  const porNome=sugerirProdutosDaNota(nota('Outro'),produtos,'vi');
  assert.equal(porNome[0]?.produto.id,'v1');
  const porCodigo=sugerirProdutosDaNota(nota('Outro'),produtos,'p0009');
  assert.equal(porCodigo[0]?.produto.id,'w1');
  const porRef=sugerirProdutosDaNota(nota('Outro'),produtos,'ZAF001');
  assert.equal(porRef[0]?.produto.id,'z1');
});

test('entre variantes idênticas, somente a unidade compatível é selecionada', () => {
  const variantes=[...produtos, {...produtos[0], id:'vkg', unidade:'kg', setor_id:'s2'}];
  assert.equal(encontrarProdutoExatoDaNota(nota('Viance','L'), variantes)?.id,'v1');
});

test('unidade incompatível impede vínculo automático mesmo com nome idêntico', () => {
  assert.equal(encontrarProdutoExatoDaNota(nota('Viance','kg'), produtos), null);
  assert.equal(encontrarProdutoExatoDaNota(nota('Viance','L'), produtos)?.id,'v1');
});

test('produto em TON aceita automaticamente NF-e em TN T ton e TO', () => {
  const cadastrado = [{
    id: 'f1', nome: 'FERTILIZANTE', unidade: 'ton', setor_id: 's1',
  }];
  for (const unidade of ['TN', 'Tn', 'T', 't', 'ton', 'TO', 'TONELADAS']) {
    assert.equal(encontrarProdutoExatoDaNota(nota('FERTILIZANTE', unidade), cadastrado)?.id, 'f1', unidade);
  }
});
test('NF-e em TN e cadastro em kg identificam nome exato por unidade fisica conhecida', () => {
  const kg = [{ id: 'f1', nome: 'FERTILIZANTE', unidade: 'kg', setor_id: 's1' }];
  assert.equal(encontrarProdutoExatoDaNota(nota('FERTILIZANTE', 'TN'), kg)?.id, 'f1');
  assert.equal(encontrarProdutoExatoDaNota(nota('FERTILIZANTE', 'TON'), kg)?.id, 'f1');
  assert.equal(encontrarProdutoExatoDaNota(nota('FERTILIZANTE', 'TO'), kg)?.id, 'f1');
  assert.equal(encontrarProdutoExatoDaNota(nota('FERTILIZANTE', 'TN'),
    [{ ...kg[0], unidade_alt: 'T', fator_conversao: 1000 }])?.id, 'f1');
  // Nome comercial diferente ainda nao autoriza auto-vinculo.
  assert.equal(encontrarProdutoExatoDaNota(nota('CALCARIO', 'TON'),
    [{ ...kg[0], nome: 'CALCARIO AGRICOLA DOLOMITICO' }]), null);
  assert.equal(encontrarProdutoExatoDaNota(nota('FERTILIZANTE', 'CX'), kg), null);
});
test('não confunde uma marca dentro do nome de outra', () => {
  assert.equal(encontrarProdutoExatoDaNota(nota('Vian'), produtos), null);
  assert.equal(encontrarProdutoExatoDaNota(nota('Viance Nova Formula'), produtos), null);
});

test('filtro considera toda a lista antes de limitar sugestões', () => {
  const muitos=Array.from({length:200},(_,i)=>({
    id:'p'+i,nome:'PRODUTO '+i,codigo:'X'+i,unidade:'L',
  }));
  const todos=[...muitos,produtos[0]];
  const achados=sugerirProdutosDaNota(nota('Viance'),todos);
  assert.equal(achados[0]?.produto.id,'v1');
});
