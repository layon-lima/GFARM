import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chaveNfeNumerica, linkConsultaFiscalNfe,
  interpretarValidadeLivre, formatarValidadeInicial,
} from '../src/lib/consultaFiscalNfe.js';

const chave = '21261010515785002213550020001773901444699036';

test('chave completa abre a consulta no dominio oficial e ja leva os 44 digitos', () => {
  assert.equal(chave.length, 44);
  const link = linkConsultaFiscalNfe(chave);
  const url = new URL(link);
  assert.equal(url.origin, 'https://www.nfe.fazenda.gov.br');
  assert.equal(url.pathname, '/portal/consultaRecaptcha.aspx');
  assert.equal(url.searchParams.get('nfe'), chave);
  assert.equal(url.searchParams.get('tipoConsulta'), 'resumo');
});

test('chave com pontuacao e espacos eh limpa; chave incompleta nao abre consulta', () => {
  assert.equal(chaveNfeNumerica('21 26-10'), '212610');
  assert.equal(linkConsultaFiscalNfe(chave.slice(0, 20) + ' ' + chave.slice(20)), linkConsultaFiscalNfe(chave));
  assert.equal(linkConsultaFiscalNfe('123'), null);
  assert.equal(linkConsultaFiscalNfe(''), null);
});

test('validade com seis numeros vira DD/MM/AAAA e ISO', () => {
  assert.deepEqual(interpretarValidadeLivre('010126'), {
    exibicao: '01/01/2026', iso: '2026-01-01',
  });
});

test('validade com oito numeros vira mesma data', () => {
  assert.deepEqual(interpretarValidadeLivre('01012026'), {
    exibicao: '01/01/2026', iso: '2026-01-01',
  });
  assert.deepEqual(interpretarValidadeLivre('01/01/2026'), {
    exibicao: '01/01/2026', iso: '2026-01-01',
  });
});

test('data da nota em ISO aparece em formato brasileiro sem alterar significado', () => {
  assert.equal(formatarValidadeInicial('2026-11-12'), '12/11/2026');
  assert.equal(formatarValidadeInicial(''), '');
  assert.equal(interpretarValidadeLivre('2026-11-12')?.iso, '2026-11-12');
});

test('validade invalida ou incompleta nao e arredondada silenciosamente', () => {
  assert.equal(interpretarValidadeLivre('0101'), null);
  assert.equal(interpretarValidadeLivre('310226'), null);
  assert.equal(interpretarValidadeLivre('29022025'), null);
  assert.equal(interpretarValidadeLivre('32122026'), null);
  assert.equal(interpretarValidadeLivre(''), null);
});

test('29/02 so e valido em ano bissexto e permite apagar o campo livremente', () => {
  assert.equal(interpretarValidadeLivre('290224')?.iso, '2024-02-29');
  assert.equal(interpretarValidadeLivre('290226'), null);
  assert.equal(formatarValidadeInicial('0101'), '0101');
});
