export function getDisplayName(user) {
  if (!user) return '';

  return (
    (user.display_name && user.display_name.trim()) ||
    user.username ||
    ''
  );
}

export function getDisplayInitial(user) {
  const name = getDisplayName(user);

  return (name || '?')
    .charAt(0)
    .toUpperCase();
}
