// A captura e imediata; a selecao manual so serve para refazer o campo escolhido.
// O peso real e obtido no contexto da balanca e registrado pelo fluxo de ticket existente.
export function etapaCapturaPesagem({
  ticketAberto,
  segundaRegistrada,
  etapaSelecionada = 0,
}) {
  if (!ticketAberto) return 1;
  if (etapaSelecionada === 1 || etapaSelecionada === 2) {
    return etapaSelecionada;
  }
  return segundaRegistrada ? 0 : 2;
}

export function recapturaPrimeiraValida({
  statusTicket,
  primeiraNova,
  segundaRegistrada,
  segundaPeso,
}) {
  return (
    statusTicket === 'aberto' &&
    Number.isFinite(primeiraNova) &&
    primeiraNova > 0 &&
    (
      !segundaRegistrada ||
      Math.abs(primeiraNova - segundaPeso) >= 0.0001
    )
  );
}

// Alterar o tipo deve preservar o preenchimento comum; pedido so se aplica
// a ticket de venda e nao deve ficar vinculado a outros tipos de ticket.
export function atualizarTipoTicket(form, novoTipo) {
  return {
    ...form,
    tipo: novoTipo,
    pedido_id: novoTipo === 'venda' ? (form.pedido_id || '') : '',
  };
}
