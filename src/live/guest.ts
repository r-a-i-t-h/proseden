export const GUEST_COOKIE = "proseden_guest";

export function guestCookieName(sessionCookieName: string): string {
  if (sessionCookieName.endsWith("_session")) {
    return `${sessionCookieName.slice(0, -"_session".length)}_guest`;
  }
  return GUEST_COOKIE;
}

export function parseGuestId(raw: string | undefined): string | undefined {
  if (raw && /^[a-f0-9]{16,64}$/i.test(raw)) return raw;
  return undefined;
}

export function guestUserKey(guestId: string): string {
  return `g:${guestId}`;
}
