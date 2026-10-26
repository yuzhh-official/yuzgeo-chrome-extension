/** True for refs that point outside the local file tree. */
export function isExternalRef(ref: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);
}

/**
 * Resolves an image ref found in `filePath` to a path relative to the asset root, or `null` when it
 * is external or escapes the root. Both inputs use `/` separators; the result has no `./` segments.
 */
export function resolveAssetPath(filePath: string, ref: string): string | null {
  if (isExternalRef(ref)) return null;

  let cleaned = ref.split(/[?#]/)[0] ?? '';
  try {
    cleaned = decodeURI(cleaned);
  } catch {
    // Keep the raw ref when it isn't valid percent-encoding.
  }
  if (!cleaned) return null;

  const base = cleaned.startsWith('/') ? [] : filePath.split('/').slice(0, -1);
  const segments = [...base];
  for (const part of cleaned.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return segments.length ? segments.join('/') : null;
}
