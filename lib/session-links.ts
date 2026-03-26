const TOKEN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function createShareToken(length = 28) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => TOKEN_ALPHABET[value % TOKEN_ALPHABET.length]).join("");
}

export function buildEditorPath(token: string) {
  return `/s/edit/${token}`;
}

export function buildViewerPath(token: string) {
  return `/s/view/${token}`;
}

export function buildAbsoluteUrl(origin: string, path: string) {
  return new URL(path, origin).toString();
}
