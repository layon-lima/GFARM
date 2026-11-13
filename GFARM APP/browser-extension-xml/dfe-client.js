// Consulta NF-e distNSU no proprio Chrome/Edge com certificado TLS do Windows.
// Executado EXCLUSIVAMENTE no service worker da extensao GFARM (host permission).
// Nao exporta nem le chaves privadas; o navegador negocia o mTLS.
(() => {
  'use strict';
  const URL_DFE = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
  const NS_WS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
  const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
  const MAX_RESPONSE = 18 * 1024 * 1024;
  const MAX_DOCUMENTS = 50;
  const MAX_ZIP_BASE64 = 15 * 1024 * 1024;

  function validar(interessado, cuf, ultNsu) {
    if (!/^(?:\d{11}|\d{14})$/.test(String(interessado))) throw Error('CPF/CNPJ invalido.');
    if (!/^\d{2}$/.test(String(cuf))) throw Error('UF invalida.');
    if (!Number.isSafeInteger(ultNsu) || ultNsu < 0 || ultNsu > 999999999999999) {
      throw Error('NSU invalido.');
    }
  }

  function montarEnvelope(interessado, cuf, ultNsu) {
    validar(interessado, cuf, ultNsu);
    const campo = interessado.length === 11 ? 'CPF' : 'CNPJ';
    return '<?xml version="1.0" encoding="UTF-8"?>' +
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">' +
      '<soap:Body><nfeDistDFeInteresse xmlns="' + NS_WS + '">' +
      '<nfeDadosMsg><distDFeInt xmlns="' + NS_NFE + '" versao="1.01">' +
      '<tpAmb>1</tpAmb><cUFAutor>' + cuf + '</cUFAutor>' +
      '<' + campo + '>' + interessado + '</' + campo + '>' +
      '<distNSU><ultNSU>' + String(ultNsu).padStart(15, '0') + '</ultNSU></distNSU>' +
      '</distDFeInt></nfeDadosMsg></nfeDistDFeInteresse></soap:Body></soap:Envelope>';
  }

  function tag(xml, nome) {
    const re = new RegExp('<(?:(?:[\\w.-]+):)?' + nome +
      '(?:\\s[^>]*)?>([^<]*)<\\/(?:(?:[\\w.-]+):)?' + nome + '\\s*>', 'i');
    return re.exec(xml)?.[1]?.trim() || '';
  }

  function atributo(str, nome) {
    const re = new RegExp('(?:^|\\s)' + nome + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27)', 'i');
    const match = re.exec(str);
    return match?.[1] || match?.[2] || '';
  }

  function interpretarRetorno(xml, anteriorNsu) {
    if (typeof xml !== 'string' || !xml.length || xml.length > MAX_RESPONSE) {
      throw Error('Resposta da SEFAZ vazia ou acima do limite.');
    }
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Resposta XML com entidade proibida.');
    const ret = /<(?:[\w.-]+:)?retDistDFeInt\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?retDistDFeInt\s*>/i.exec(xml)?.[1];
    if (!ret) throw Error('Resposta sem retDistDFeInt; confira certificado e conexao.');
    const cstat = tag(ret, 'cStat');
    if (!['137', '138', '656'].includes(cstat)) {
      throw Error('SEFAZ retornou codigo ' + (cstat || 'desconhecido') + '; nao houve importacao.');
    }
    const ult = Number(tag(ret, 'ultNSU') || anteriorNsu);
    const max = Number(tag(ret, 'maxNSU') || anteriorNsu);
    if (!Number.isSafeInteger(ult) || !Number.isSafeInteger(max) ||
        ult < anteriorNsu || max < ult || max > 999999999999999) {
      throw Error('Sequencia de NSU retornada pela SEFAZ e invalida.');
    }
    const documentos = [];
    let total = 0;
    const re = /<(?:[\w.-]+:)?docZip\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?docZip\s*>/gi;
    let match;
    while ((match = re.exec(ret)) !== null) {
      const nsu = Number(atributo(match[1], 'NSU'));
      const schema_xml = atributo(match[1], 'schema');
      const doc_zip = match[2].replace(/\s+/g, '');
      if (!Number.isSafeInteger(nsu) || nsu <= 0 || !/^[A-Za-z0-9+/]+=*$/.test(doc_zip)) {
        throw Error('Documento comprimido invalido retornado pela SEFAZ.');
      }
      total += doc_zip.length;
      documentos.push({ nsu, schema_xml, doc_zip });
      if (documentos.length > MAX_DOCUMENTS || total > MAX_ZIP_BASE64) {
        throw Error('Lote da SEFAZ acima do limite seguro de memoria.');
      }
    }
    if (cstat === '138' && !documentos.length) {
      throw Error('SEFAZ informou documentos, mas nao enviou docZip.');
    }
    if (cstat !== '138' && documentos.length) {
      throw Error('SEFAZ enviou docZip com status inesperado.');
    }
    return { cstat, ult_nsu: ult, max_nsu: max, documentos };
  }

  async function consultar(interessado, cuf, ultNsu) {
    const body = montarEnvelope(interessado, cuf, ultNsu);
    // Se a selecao de certificado for solicitada, pertence ao navegador.
    let response;
    try {
      response = await fetch(URL_DFE, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8; action="' + NS_WS + '/nfeDistDFeInteresse"',
        },
        body,
      });
    } catch {
      throw Error('Conexao SEFAZ recusada. Confira o certificado no navegador.');
    }
    if (!response.ok) {
      throw Error('SEFAZ retornou HTTP ' + response.status + '. Confira o certificado digital.');
    }
    return interpretarRetorno(await response.text(), ultNsu);
  }

  globalThis.GFARM_DFE = { consultar, montarEnvelope, interpretarRetorno };
})();
