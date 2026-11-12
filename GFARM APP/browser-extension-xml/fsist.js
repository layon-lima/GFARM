// Preenche a chave somente quando um recebimento GFARM estiver em consulta.
// Nunca clica no captcha, emite downloads nem seleciona certificados.
(() => {
  chrome.runtime.sendMessage({ channel: 'GFARM_FSIST_PREFILL' }, (response) => {
    if (chrome.runtime.lastError || !/^\d{44}$/.test(response?.chave || '')) return;
    const key = response.chave;
    let obs;
    function tryFill() {
      const inputs = Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=password])'));
      const ranked = inputs.map(input => {
        const text = [input.id, input.name, input.placeholder, input.getAttribute('aria-label'),
          input.closest('label')?.textContent, input.parentElement?.textContent?.slice(0, 140)]
          .join(' ').toLowerCase();
        const score = (/chave|chavenfe|chavenota/.test(text) ? 10 : 0) +
          (Number(input.maxLength) === 44 ? 6 : 0);
        return { input, score };
      }).filter(x => x.score >= 6).sort((a,b) => b.score - a.score);
      const target = ranked[0]?.input;
      if (!target || target.value.trim()) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(target, key);
      else target.value = key;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (tryFill()) return;
    let tries = 0;
    obs = new MutationObserver(() => {
      tries += 1;
      if (tryFill() || tries >= 100) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs?.disconnect(), 15000);
  });
})();
