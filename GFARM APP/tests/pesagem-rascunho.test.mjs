import assert from 'node:assert/strict';
import test from 'node:test';
import {
  salvarRascunhoPesagem,
  lerRascunhoPesagem,
  existeRascunhoPesagem,
} from '../src/lib/pesagemRascunho.js';

test('captura da primeira pesagem permanece pendente até Salvar e resiste ao retorno do pré-cadastro', () => {
  const dados = new Map();
  const storageAnterior = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => dados.get(key) ?? null,
    setItem: (key, value) => dados.set(key, String(value)),
    removeItem: (key) => dados.delete(key),
  };
  try {
    const usuario = { id: 'teste-pesagem-pendente' };
    const pendente = {
      form: { tipo: 'compra', motorista: 'MOTORISTA TESTE', placa: 'ABC1D23' },
      primeiraPendente: 25840,
      primeiraPendenteEm: '2026-10-28T11:00:00.000Z',
      segundaPesagem: 0,
    };
    assert.equal(existeRascunhoPesagem(pendente), true);
    salvarRascunhoPesagem(usuario, pendente);
    const restaurado = lerRascunhoPesagem(usuario);
    assert.equal(restaurado.form.motorista, 'MOTORISTA TESTE');
    assert.equal(restaurado.primeiraPendente, 25840);
    assert.equal(restaurado.primeiraPendenteEm, pendente.primeiraPendenteEm);

    // Após a escolha de imprimir ou não imprimir, o formulário vazio
    // não deve recuperar uma captura antiga.
    salvarRascunhoPesagem(usuario, { form: {} });
    assert.equal(lerRascunhoPesagem(usuario).primeiraPendente, 0);
    assert.equal(dados.size, 0);
  } finally {
    globalThis.localStorage = storageAnterior;
  }
});
