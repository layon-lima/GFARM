// Coordena a interceptação do botão/gesto de voltar do sistema (mobile) para
// recolher overlays passo a passo em vez de navegar/sair da rota.
// Pilha LIFO global com um único listener de popstate.

const entries = []; // { onBack, consumed }
let listening = false;
let nextEntryId = 0;

function onPop() {
  const top = entries[entries.length - 1];
  if (top && !top.consumed) {
    top.consumed = true;
    entries.pop();
    try { top.onBack(); } catch (e) { /* noop */ }
  }
  // Sem handler no topo: deixa o voltar natural navegar.
}

function ensureListener() {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', onPop);
}

// Empurra uma entrada de history para capturar o próximo "voltar".
// Retorna função de limpeza para retirar o handler sem navegar para trás.
export function pushBackEntry(onBack) {
  ensureListener();
  const id = `mobile-back-${++nextEntryId}`;
  const entry = { id, onBack, consumed: false };
  entries.push(entry);
  window.history.pushState(
    {
      ...(window.history.state || {}),
      __backHandler: id,
    },
    ''
  );

  return function unregister() {
    const idx = entries.indexOf(entry);

    if (idx >= 0) {
      entries.splice(idx, 1);

      // Fechar uma camada pela interface ou desmontar a página durante uma
      // navegação não pode executar history.back(): isso desfazia o clique em
      // "Início" depois de pesquisar, expandir ou segurar um produto.
      if (
        window.history.state?.__backHandler === id
      ) {
        const nextState = {
          ...(window.history.state || {}),
        };

        delete nextState.__backHandler;
        window.history.replaceState(nextState, '');
      }
    }
    // se já foi consumido pelo popstate, nada a fazer.
  };
}
