export function resolveMediaUrl(value) {
  const raw = String(value || '').trim();

  if (!raw) return '';

  if (
    raw.startsWith('data:') ||
    raw.startsWith('blob:')
  ) {
    return raw;
  }

  try {
    const parsed = new URL(raw, window.location.origin);

    // Uploads locais antigos guardavam o host que realizou o envio. No
    // celular isso normalmente era "localhost", que aponta para o próprio
    // aparelho. O arquivo deve sempre ser pedido ao host atual do sistema.
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${window.location.origin}${parsed.pathname}${parsed.search}`;
    }

    return parsed.href;
  } catch {
    return raw;
  }
}
