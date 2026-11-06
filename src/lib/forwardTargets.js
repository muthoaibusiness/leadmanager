// The people a lead can be forwarded to: the user's own team (agents and the Team Lead) plus, when the
// account has extra_forward_user_ids (migration 0064), those named users from other teams.
// Each side is an array of mapped users; the user themself never appears and nobody twice.
export function mergeForwardTargets(own, extra, selfId) {
  const seen = new Set();
  return [...(own || []), ...(extra || [])]
    .filter((u) => u && u.id !== selfId && !seen.has(u.id) && seen.add(u.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// The query for those users; null when the account has none.
export function extraUsersFilter(userIds) {
  const ids = (Array.isArray(userIds) ? userIds : []).map((t) => String(t).replace(/[^\w-]/g, '')).filter(Boolean);
  return ids.length ? `id=in.(${ids.join(',')})&is_active=not.eq.false` : null;
}
