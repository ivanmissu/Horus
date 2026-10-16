// Arena iframe fallback only. Never use this bearer token outside an explicitly
// enabled, disposable embedded preview: unlike the normal Cookie it is JS-readable.
export const EMBEDDED_SESSION_KEY = "horus_embedded_session";

export function embeddedAuthHeaders(): Record<string, string> {
  const token = sessionStorage.getItem(EMBEDDED_SESSION_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
