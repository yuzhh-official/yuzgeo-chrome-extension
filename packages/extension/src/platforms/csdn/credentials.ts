/**
 * Obtains bizapi signing material at runtime from CSDN's own editor page and JS bundles,
 * so no key or secret lives in this repository. Cached in memory for the worker's lifetime.
 */
import { request } from '../../lib/http';
import type { SigningMaterial } from './sign';

export const EDITOR_PAGE_URL = 'https://mp.csdn.net/mp_blog/creation/editor';
/** Hosts whose scripts may carry the editor's API client. */
const BUNDLE_HOSTS = ['mp.csdn.net', 'g.csdnimg.cn', 'csdnimg.cn'];
/** Upper bound on bundles fetched per extraction. */
const MAX_BUNDLES = 20;

/*
 * The editor's request helper configures the gateway key/secret as string literals. Property
 * names vary between builds, so match a few spellings; the key is numeric, the secret alphanumeric.
 */
const KEY_PATTERNS = [
  /\[\s*["']x-ca-key["']\s*\]\s*=\s*["'](\d{6,12})["']/i,
  /["']?(?:appKey|app_key|caKey|xCaKey|x-ca-key)["']?\s*[:=,]\s*["'](\d{6,12})["']/i,
];
const SECRET_PATTERNS = [
  /["']?(?:appSecret|app_secret|caSecret|xCaSecret|secret)["']?\s*[:=]\s*["']([A-Za-z0-9]{16,64})["']/i,
];

export interface SigningMaterialSource {
  (signal: AbortSignal): Promise<SigningMaterial>;
}

/** Extracts `<script src>` URLs on CSDN hosts, resolved against the page URL. */
export function findBundleUrls(html: string, pageUrl: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1] ?? '', pageUrl);
      if (url.protocol === 'https:' && BUNDLE_HOSTS.includes(url.hostname)) urls.push(url.href);
    } catch {
      // Malformed src; skip.
    }
  }
  return [...new Set(urls)];
}

function firstMatch(patterns: RegExp[], text: string): string | undefined {
  for (const pattern of patterns) {
    const value = pattern.exec(text)?.[1];
    if (value) return value;
  }
  return undefined;
}

/** Finds a key/secret pair in one piece of JS (or inline HTML). Both must come from the same text. */
export function extractSigningMaterial(code: string): SigningMaterial | undefined {
  const appKey = firstMatch(KEY_PATTERNS, code);
  const appSecret = firstMatch(SECRET_PATTERNS, code);
  return appKey && appSecret ? { appKey, appSecret } : undefined;
}

/** Fetches the editor page, then its bundles, until one yields a key/secret pair. */
export const fetchSigningMaterial: SigningMaterialSource = async (signal) => {
  const html = await (await request(EDITOR_PAGE_URL, { signal })).text();
  const inline = extractSigningMaterial(html);
  if (inline) return inline;

  // App bundles are usually listed last, after vendor/runtime chunks.
  const bundles = findBundleUrls(html, EDITOR_PAGE_URL)
    .reverse()
    // Prefer the current creator-center client over shared tracking/legacy SDKs.
    .sort((a, b) => Number(b.includes('/release/mpfev3/')) - Number(a.includes('/release/mpfev3/')))
    .slice(0, MAX_BUNDLES);
  for (const url of bundles) {
    let code: string;
    try {
      code = await (await request(url, { signal, credentials: 'omit' })).text();
    } catch (error) {
      if (signal.aborted) throw error;
      continue;
    }
    const material = extractSigningMaterial(code);
    if (material) return material;
  }
  throw new Error(
    `未能从 CSDN 编辑器页面（检查了 ${bundles.length} 个脚本）中解析出接口签名参数，CSDN 可能已改版，请反馈给扩展作者`,
  );
};

let source: SigningMaterialSource = fetchSigningMaterial;
let cached: Promise<SigningMaterial> | undefined;

/** The single injection point for signing material (tests, or a future alternative source). */
export function setSigningMaterialSource(next: SigningMaterialSource = fetchSigningMaterial): void {
  source = next;
  cached = undefined;
}

export function getSigningMaterial(signal: AbortSignal): Promise<SigningMaterial> {
  if (!cached) {
    const pending = source(signal);
    cached = pending;
    // Don't keep a failed lookup around; the next call retries.
    pending.catch(() => {
      if (cached === pending) cached = undefined;
    });
  }
  return cached;
}

/** Drops the cached material, e.g. after the gateway rejected a signature. */
export function invalidateSigningMaterial(): void {
  cached = undefined;
}
