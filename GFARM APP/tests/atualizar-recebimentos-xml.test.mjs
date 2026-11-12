import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarItensFiscaisXml } from '../src/lib/atualizarRecebimentosXml.js';

test('um XML preenche todos os cards da mesma nota por origem_id', () => {
  const itens = [
    { origem_id: 'mbio', dados: { numero_nota: '177671', produto: 'MBIO Brady', valor_total: null } },
    { origem_id: 'viance', dados: { numero_nota: '177671', produto: 'Viance', valor_total: null } },
    { origem_id: 'kcl', dados: { numero_nota: '40541', produto: 'KCL', valor_total: null } },
  ];
  const atualizados = [
    { origem_id: 'mbio', dados: { ...itens[0].dados, valor_unitario: '12.5', valor_total: '116000', custo_origem: 'xml_conferido' } },
    { origem_id: 'viance', dados: { ...itens[1].dados, valor_unitario: '45.5', valor_total: '11375', custo_origem: 'xml_conferido' } },
  ];
  const resultado = aplicarItensFiscaisXml(itens, atualizados);
  assert.equal(resultado[0].dados.valor_total, '116000');
  assert.equal(resultado[0].dados.valor_unitario, '12.5');
  assert.equal(resultado[1].dados.valor_total, '11375');
  assert.equal(resultado[2], itens[2]);
  assert.equal(resultado[2].dados.valor_total, null);
  assert.equal(itens[0].dados.valor_total, null);
});

test('retorno sem dados fiscais nao afirma alteracoes', () => {
  const itens = [{ origem_id: 'mbio', dados: { valor_total: null } }];
  assert.equal(aplicarItensFiscaisXml(itens, []), itens);
  assert.deepEqual(aplicarItensFiscaisXml(itens, [{ origem_id: 'mbio' }]), itens);
});
