import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atualizarTipoTicket,
  etapaCapturaPesagem,
  recapturaPrimeiraValida,
} from '../src/lib/pesagemCaptureFlow.js';

test('sem ticket, um clique faz a primeira pesagem', () => {
  assert.equal(etapaCapturaPesagem({
    ticketAberto: false,
    segundaRegistrada: false,
  }), 1);
});

test('primeira salva: proxima captura faz a segunda sem confirmar', () => {
  assert.equal(etapaCapturaPesagem({
    ticketAberto: true,
    segundaRegistrada: false,
  }), 2);
});

test('duas pesagens registradas: nao realiza nova captura automaticamente', () => {
  assert.equal(etapaCapturaPesagem({
    ticketAberto: true,
    segundaRegistrada: true,
  }), 0);
});

test('clicar no campo da primeira habilita refazer mesmo apos a segunda', () => {
  assert.equal(etapaCapturaPesagem({
    ticketAberto: true,
    segundaRegistrada: true,
    etapaSelecionada: 1,
  }), 1);
});

test('clicar no campo da segunda habilita refazer apenas a segunda', () => {
  assert.equal(etapaCapturaPesagem({
    ticketAberto: true,
    segundaRegistrada: true,
    etapaSelecionada: 2,
  }), 2);
});

test('sem ticket, nao antecipa a segunda pesagem', () => {
  assert.equal(etapaCapturaPesagem({
    ticketAberto: false,
    segundaRegistrada: false,
    etapaSelecionada: 2,
  }), 1);
});

test('recaptura nao permite alterar ticket fechado', () => {
  assert.equal(recapturaPrimeiraValida({
    statusTicket: 'fechado',
    primeiraNova: 2400,
    segundaRegistrada: false,
    segundaPeso: 0,
  }), false);
});

test('recaptura nao pode repetir o peso da segunda', () => {
  assert.equal(recapturaPrimeiraValida({
    statusTicket: 'aberto',
    primeiraNova: 2400,
    segundaRegistrada: true,
    segundaPeso: 2400,
  }), false);
});

test('recaptura valida preserva o ticket aberto', () => {
  assert.equal(recapturaPrimeiraValida({
    statusTicket: 'aberto',
    primeiraNova: 2400,
    segundaRegistrada: true,
    segundaPeso: 1600,
  }), true);
});

test('trocar o tipo preserva dados preenchidos comuns', () => {
  const original = {
    tipo: 'compra',
    pedido_id: '',
    motorista: 'Motorista Teste',
    placa: 'ABC1D23',
    produto_id: 'produto-1',
    cliente_id: 'cliente-1',
    transportadora_id: 'transportadora-1',
    origem: 'Sede',
    destino: 'Armazém',
    observacao: 'Conferido',
  };
  const novo = atualizarTipoTicket(original, 'entrada_saida');
  assert.equal(novo.tipo, 'entrada_saida');
  for (const key of [
    'motorista', 'placa', 'produto_id', 'cliente_id',
    'transportadora_id', 'origem', 'destino', 'observacao',
  ]) {
    assert.equal(novo[key], original[key], key);
  }
  assert.deepEqual(original, {
    ...original,
    tipo: 'compra',
  });
});

test('pedido de venda não permanece vinculado quando muda para outro tipo', () => {
  const original = {
    tipo: 'venda',
    pedido_id: 'pedido-123',
    motorista: 'Motorista Teste',
    placa: 'ABC1D23',
  };
  const outroTipo = atualizarTipoTicket(original, 'compra');
  assert.equal(outroTipo.pedido_id, '');
  assert.equal(outroTipo.motorista, original.motorista);
  assert.equal(outroTipo.placa, original.placa);
  const venda = atualizarTipoTicket(original, 'venda');
  assert.equal(venda.pedido_id, 'pedido-123');
});
