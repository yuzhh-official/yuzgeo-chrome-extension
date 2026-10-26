import { getCookie, HttpError, request } from '../../lib/http';

/*
 * Everything below that touches the platform's private web API is inferred, not documented.
 * Keep the uncertain details here so they can be corrected after capturing real traffic.
 */
export const ORIGIN = 'https://cloud.tencent.com';
export const API_BASE = `${ORIGIN}/developer/api`;
export const WRITE_PAGE = `${ORIGIN}/developer/article/write`;
export const SESSION_PATH = '/user/session';
export const ADD_DRAFT_PATH = '/article/addArticleDraft';
export const editorUrl = (draftId: string) =>
  `${WRITE_PAGE}?draftId=${encodeURIComponent(draftId)}`;
/** Cookies tried, in order, as the CSRF token source. */
export const CSRF_COOKIE_NAMES = ['skey', 'p_skey'] as const;
export const CSRF_QUERY_PARAM = 'csrfCode';
/** `sourceType` value for an original (原创) article. */
export const SOURCE_TYPE_ORIGINAL = 1;

/** Response envelope the developer community API is assumed to use. */
export interface TencentResponse<T> {
  code?: number;
  ret?: number;
  msg?: string;
  message?: string;
  data?: T;
}

export class TencentCloudError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'TencentCloudError';
  }
}

/** The classic Tencent "g_tk" hash (DJB-style, seed 5381) used to derive CSRF tokens from skey. */
export function csrfHash(skey: string): number {
  let hash = 5381;
  for (let i = 0; i < skey.length; i++) hash += (hash << 5) + skey.charCodeAt(i);
  return hash & 0x7fffffff;
}

/** Reads the skey-like cookie and returns the derived CSRF token. */
export async function csrfToken(): Promise<string> {
  for (const name of CSRF_COOKIE_NAMES) {
    const value = await getCookie(ORIGIN, name);
    if (value) return String(csrfHash(value));
  }
  throw new Error(
    '未找到腾讯云的登录 Cookie（skey），请先在浏览器中登录 cloud.tencent.com/developer 后重试',
  );
}

export function apiUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function errorText(json: TencentResponse<unknown>, code: number): string {
  return json.msg || json.message || `code ${code}`;
}

/** Extracts the platform's message from an HTTP error body when it is a JSON envelope. */
function httpErrorText(error: HttpError): string {
  try {
    const parsed = JSON.parse(error.body) as TencentResponse<unknown>;
    const message = parsed.msg || parsed.message;
    if (message) return `${message}（HTTP ${error.status}）`;
  } catch {
    // Not JSON; fall through.
  }
  return `HTTP ${error.status}`;
}

/** Calls a developer API endpoint and unwraps `data`, throwing TencentCloudError when code != 0. */
export async function callApi<T>(url: string, init: RequestInit, action: string): Promise<T> {
  let json: TencentResponse<T>;
  try {
    const response = await request(url, init);
    json = (await response.json()) as TencentResponse<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const detail =
      error instanceof HttpError
        ? httpErrorText(error)
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`腾讯云开发者社区${action}失败：${detail}`, { cause: error });
  }
  const code = json.code ?? json.ret ?? 0;
  if (code !== 0) {
    throw new TencentCloudError(code, `腾讯云开发者社区${action}失败：${errorText(json, code)}`);
  }
  return json.data as T;
}
