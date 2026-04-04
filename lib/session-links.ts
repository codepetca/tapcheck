const TOKEN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function createShareToken(length = 28) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => TOKEN_ALPHABET[value % TOKEN_ALPHABET.length]).join("");
}

export function buildCheckInPath(token: string) {
  return `/check-in/${token}`;
}

export function buildStaffSessionPath(rosterId: string, sessionId: string) {
  return `/rosters/${rosterId}/sessions/${sessionId}`;
}

export function buildSessionDisplayPath(rosterId: string, sessionId: string) {
  return `/rosters/${rosterId}/sessions/${sessionId}/display`;
}

export function buildEditorPath(token: string) {
  return buildCheckInPath(token);
}

export function buildAbsoluteUrl(origin: string, path: string) {
  return new URL(path, origin).toString();
}

export function getConfiguredAppOrigin() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) {
    return null;
  }

  try {
    return new URL(appUrl).origin;
  } catch {
    return null;
  }
}

export function resolveCheckInUrl(token: string, origin?: string | null) {
  const path = buildCheckInPath(token);
  if (!origin) {
    return path;
  }

  return buildAbsoluteUrl(origin, path);
}
