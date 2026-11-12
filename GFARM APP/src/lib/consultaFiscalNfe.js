// Consulta publica oficial: a chave entra na URL, mas o portal exige captcha.
const PORTAL_NFE = 'https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx';

export function chaveNfeNumerica(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

export function linkConsultaFiscalNfe(chave) {
  const digitos = chaveNfeNumerica(chave);
  if (!/^\d{44}$/.test(digitos)) return null;
  const url = new URL(PORTAL_NFE);
  url.searchParams.set('tipoConsulta', 'completa');
  url.searchParams.set('tipoConteudo', 'XbSeqxE8pl8=');
  url.searchParams.set('nfe', digitos);
  return url.toString();
}

export function interpretarValidadeLivre(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;

  let dia, mes, ano;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (iso) {
    ano = Number(iso[1]);
    mes = Number(iso[2]);
    dia = Number(iso[3]);
  } else {
    const digitos = texto.replace(/\D/g, '');
    if (digitos.length !== 6 && digitos.length !== 8) return null;
    dia = Number(digitos.slice(0, 2));
    mes = Number(digitos.slice(2, 4));
    ano = digitos.length === 6
      ? 2000 + Number(digitos.slice(4, 6))
      : Number(digitos.slice(4, 8));
  }

  if (ano < 1000 || ano > 9999 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 ||
      data.getUTCDate() !== dia) return null;

  const dd = String(dia).padStart(2, '0');
  const mm = String(mes).padStart(2, '0');
  const yyyy = String(ano).padStart(4, '0');
  return { exibicao: dd + '/' + mm + '/' + yyyy, iso: yyyy + '-' + mm + '-' + dd };
}

export function formatarValidadeInicial(valor) {
  if (!String(valor ?? '').trim()) return '';
  return interpretarValidadeLivre(valor)?.exibicao || String(valor);
}
