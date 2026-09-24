/**
 * Post-login destination from a `?next=` parameter. Only same-origin absolute
 * paths are accepted, so the parameter cannot be used as an open redirect.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  if (
    value.startsWith("/api/") ||
    value === "/login" ||
    value.startsWith("/login?") ||
    value.startsWith("/refresh")
  ) {
    return fallback;
  }
  return value;
}
