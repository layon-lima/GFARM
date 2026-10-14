import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
