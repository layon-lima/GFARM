import { useEffect } from 'react';

// Setters nativos de `value` do prototype. Usados para alterar o valor do DOM
// SEM passar pelo value-tracker que o React instala nas instâncias controladas.
// Se usarmos `el.value = upper`, o tracker do React registra o novo valor e, ao
// redespatchar o evento `input`, o React não detecta diferença → o onChange não
// dispara e campos controlados (ex.: a busca do painel) param de responder.
const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;

/**
 * Aplica máscara de MAIÚSCULAS em todos os campos de texto e textarea do app.
 * Funciona em componentes controlados (React) redefinindo o valor nativo e
 * redisparando o evento 'input' para que o onChange do React capture o novo valor.
 */
export function useUppercaseInputs() {
  useEffect(() => {
    const handler = (e) => {
      const el = e.target;
      if (!el || el.nodeType !== 1) return;

      const tag = el.tagName;
      const isInput = tag === 'INPUT';
      const isTextarea = tag === 'TEXTAREA';
      if (!isInput && !isTextarea) return;

      if (isInput) {
        const type = (el.type || '').toLowerCase();
        // Ignora campos não textuais e senhas (não fazem sentido em maiúsculo)
        const skip = ['password', 'number', 'range', 'date', 'datetime-local', 'time', 'month', 'week', 'color', 'file', 'checkbox', 'radio', 'submit', 'button', 'image', 'reset', 'hidden'];
        if (skip.includes(type)) return;
      }

      if (typeof el.value !== 'string') return;
      const upper = el.value.toUpperCase();
      if (upper === el.value) return;

      const start = el.selectionStart;
      const end = el.selectionEnd;

      // Setter nativo: atualiza o valor real do DOM sem disparar o value-tracker
      // do React, permitindo que o onChange controlado dispare normalmente.
      const setter = isInput ? nativeInputSetter : nativeTextareaSetter;
      if (setter) setter.call(el, upper);
      try { el.setSelectionRange(start, end); } catch (_) { /* alguns inputs não suportam */ }

      // Redispara para que React/ControlledComponents atualizem o estado
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    document.addEventListener('input', handler, true);
    return () => document.removeEventListener('input', handler, true);
  }, []);
}

export default useUppercaseInputs;